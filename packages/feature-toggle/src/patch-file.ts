/**
 * profile 用户 patch 文件（cordis.patch.yml）中「管理条目」的读写。
 *
 * 管理条目 = 本插件追加的带管理标记注释的 {id, disabled} 覆盖行，仅允许
 * id ∈ 目录 host 行集合（封闭世界，默认拒绝）。写入纪律与 lifeboat patch-file
 * 同款：先备份、幂等、原子落盘（tmp + rename），失败抛错由调用方回滚/告警，
 * 绝不写半个文件。
 *
 * 与其他写入者的协调：
 * - lifeboat：其隔离条目与本插件管理条目同形但**不带管理标记注释** → 自然
 *   归入「外部条目」，本模块对其只读不动。启用了被 lifeboat 隔离的插件时，
 *   引擎层在写入前即拒绝（见 engine.ts / reconcile.ts）。
 * - 用户手工条目：同样不带管理标记 → 外部条目，只读不动。
 * 归属判定完全靠管理标记注释（AST commentBefore），与 id 无关——同 id 的外部
 * 条目与管理条目可并存时以外部条目优先（loader 语义：后出现的 disabled 覆盖
 * 先前的，但引擎在写入前已保证不产生这种对抗态）。
 * @module feature-toggle/patch-file
 */
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'

import { parseDocument, type YAMLMap, type YAMLSeq } from 'yaml'

import { hostRows } from './catalog.ts'
import { MANAGED_MARKER } from './ns.ts'

/** patch 文件顶层条目（松散视图）。 */
export interface PatchEntry {
  id?: string
  disabled?: unknown
  [key: string]: unknown
}

/** 归属分类结果。 */
export interface PatchClassification {
  /** 属于本插件的管理条目（带管理标记注释且 id ∈ host 行集合）。 */
  managed: PatchEntry[]
  /** id ∈ host 行集合但不带管理标记（用户手工 / lifeboat）。 */
  external: PatchEntry[]
}

const HOST_ROWS: ReadonlySet<string> = hostRows()

/** AST 条目节点是否带管理标记注释。 */
function nodeIsManaged(node: unknown): boolean {
  const comment = (node as { commentBefore?: unknown } | null)?.commentBefore
  return typeof comment === 'string' && comment.includes(MANAGED_MARKER)
}

/** AST 条目节点 → 松散 JS 视图（无 comment）。 */
function nodeToEntry(doc: ReturnType<typeof parseDocument>, node: unknown): PatchEntry | undefined {
  const js = (node as { toJS?: (doc: unknown) => unknown } | null)?.toJS?.(doc)
  if (js === null || typeof js !== 'object' || Array.isArray(js)) return undefined
  return js as PatchEntry
}

/** 顶层 seq 节点（非法结构抛错）。 */
function topSeq(doc: ReturnType<typeof parseDocument>, patchFile: string): YAMLSeq<YAMLMap> {
  const contents = doc.contents
  if (contents === null || contents.constructor?.name !== 'YAMLSeq') {
    throw new Error(`patch 文件顶层不是数组: ${patchFile}`)
  }
  return contents as unknown as YAMLSeq<YAMLMap>
}

/** 条目节点中取 id 标量值（无 id 返回 undefined）。 */
function entryId(doc: ReturnType<typeof parseDocument>, node: unknown): string | undefined {
  const js = nodeToEntry(doc, node)
  return typeof js?.id === 'string' ? js.id : undefined
}

/** 设置条目节点的 disabled 标量值（无则追加键）。 */
function setEntryDisabled(
  doc: ReturnType<typeof parseDocument>,
  node: YAMLMap,
  value: boolean,
): void {
  if (node.has('disabled')) node.set('disabled', value)
  else node.set('disabled', doc.createNode(value))
}

/**
 * 解析 patch 文件并分类 host 行集合内的顶层条目（只读，不写盘）。
 * @throws 文件不可读 / 顶层不是数组。
 */
export async function classifyPatchFile(patchFile: string): Promise<PatchClassification> {
  const doc = parseDocument(await readFile(patchFile, 'utf-8'))
  const seq = topSeq(doc, patchFile)
  const managed: PatchEntry[] = []
  const external: PatchEntry[] = []
  for (const node of seq.items) {
    const id = entryId(doc, node)
    if (id === undefined || !HOST_ROWS.has(id)) continue
    const entry = nodeToEntry(doc, node)
    if (entry === undefined) continue
    ;(nodeIsManaged(node) ? managed : external).push(entry)
  }
  return { managed, external }
}

/**
 * 使管理条目与期望禁用集合一致：缺失的追加（带管理标记）、期望启用的移除、
 * 既存的校正 disabled 值。幂等（无变化不写盘）。外部条目一律不动。
 * @param patchFile profile 用户 patch 文件绝对路径。
 * @param disabledIds 期望处于禁用态的 host 行 id 集合（必须 ⊆ host 行集合）。
 * @returns 是否实际写盘。
 * @throws 目标 id 不在 host 行集合（封闭校验）/ 顶层非数组 / 落盘失败。
 */
export async function syncManagedEntries(
  patchFile: string,
  disabledIds: ReadonlySet<string>,
): Promise<boolean> {
  for (const id of disabledIds) {
    if (!HOST_ROWS.has(id)) throw new Error(`行 ${id} 不在功能目录 host 平面集合内，拒绝写入`)
  }
  const text = await readFile(patchFile, 'utf-8')
  const doc = parseDocument(text)
  const seq = topSeq(doc, patchFile)

  let changed = false
  const seenManaged = new Set<string>()

  // 逆序遍历：移除期望启用的管理条目，校正其余的 disabled 值
  for (let index = seq.items.length - 1; index >= 0; index--) {
    const node = seq.items[index]
    if (node === null || typeof node !== 'object') continue
    if (!nodeIsManaged(node)) continue
    const id = entryId(doc, node)
    if (id === undefined || !HOST_ROWS.has(id)) continue
    const want = disabledIds.has(id)
    seenManaged.add(id)
    const entry = nodeToEntry(doc, node)
    if (!want) {
      seq.delete(index)
      changed = true
      continue
    }
    if (entry !== undefined && Boolean(entry.disabled) !== true) {
      setEntryDisabled(doc, node as YAMLMap, true)
      changed = true
    }
  }

  // 追加缺失的禁用条目
  for (const id of disabledIds) {
    if (seenManaged.has(id)) continue
    const node = doc.createNode({ id, disabled: true }) as YAMLMap
    node.commentBefore = ` ${MANAGED_MARKER}`
    seq.add(node)
    changed = true
  }

  if (!changed) return false
  await copyFile(patchFile, `${patchFile}.feature-toggle.bak`)
  const tmp = `${patchFile}.feature-toggle.tmp`
  await writeFile(tmp, doc.toString(), 'utf-8')
  await rename(tmp, patchFile)
  return true
}

/** 备份文件路径（测试与手动恢复指引共用）。 */
export function backupPath(patchFile: string): string {
  return `${patchFile}.feature-toggle.bak`
}
