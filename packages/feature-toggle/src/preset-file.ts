/**
 * 托管预设（$DSH_HOME/.agent-presets/dsh-plus-toggles/agent.cordis.yml）的行级
 * disabled 读写。
 *
 * 预设文件是官方唯一的 agent 平面编辑入口（copy + 手工编辑文件）；本模块只对
 * 目录 preset 行集合内的行增删 `disabled: true` 标量，其余一切（包括
 * `disabled: !!js` 平台条件行）绝不触碰。写入纪律：先备份、幂等、原子落盘。
 *
 * 行匹配语义（与 cordis-plugin-loader 一致）：顶层与嵌套组行（group: true 的
 * config 子列表）均按 id 定位；`delegation`/`planning` 这类组行禁用即级联全部
 * 子行（loader `_disabled()` 沿 owning parent 链）。
 * @module feature-toggle/preset-file
 */
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'

import { isCollection, isMap, parseDocument, visit, type YAMLMap, type YAMLSeq } from 'yaml'

import { presetRows } from './catalog.ts'

const PRESET_ROWS: ReadonlySet<string> = presetRows()

/** 预设文件解析结果。 */
export interface PresetFileState {
  /** 各 preset 行 id → 当前 disabled 态（标量 true 才算禁用；!!js 表达式不算）。 */
  disabled: Map<string, boolean>
  /** 文件里实际出现的目录行 id（缺行 = 源预设不含该行，无事可做）。 */
  present: Set<string>
}

/** 顶层（含嵌套组 config）是否为列表结构。 */
function isSeq(node: unknown): node is YAMLSeq<YAMLMap> {
  return isCollection(node) && Array.isArray((node as YAMLSeq).items)
}

/** AST 行节点 → {id, disabled 标量}。 */
function rowView(
  doc: ReturnType<typeof parseDocument>,
  node: unknown,
): { id: string; disabled: boolean } | undefined {
  if (!isMap(node)) return undefined
  const id = node.get('id')
  if (typeof id !== 'string') return undefined
  const js = node.toJS(doc) as { disabled?: unknown } | null
  const disabled = js !== null && typeof js === 'object' && js.disabled === true
  return { id, disabled }
}

/**
 * 遍历预设文件中所有「行节点」（顶层 + 组行 config 子列表中的行）。
 */
function walkRows(
  doc: ReturnType<typeof parseDocument>,
  seq: YAMLSeq<YAMLMap>,
  visitRow: (node: YAMLMap, id: string) => void,
): void {
  for (const node of seq.items) {
    if (node === null || typeof node !== 'object') continue
    const view = rowView(doc, node)
    if (view === undefined) continue
    visitRow(node as YAMLMap, view.id)
    const config = (node as YAMLMap).get('config', true)
    if (isSeq(config)) walkRows(doc, config, visitRow)
  }
}

/** 读取预设文件状态（只读）。 */
export async function readPresetFile(file: string): Promise<PresetFileState> {
  const doc = parseDocument(await readFile(file, 'utf-8'))
  const contents = doc.contents
  if (!isSeq(contents)) throw new Error(`预设文件顶层不是条目列表: ${file}`)
  const state: PresetFileState = { disabled: new Map(), present: new Set() }
  walkRows(doc, contents, (node, id) => {
    if (!PRESET_ROWS.has(id)) return
    state.present.add(id)
    state.disabled.set(id, rowView(doc, node)?.disabled === true)
  })
  return state
}

/**
 * 读取预设文件全部行 id（扁平化，含嵌套组行与组内子行；漂移对拍用，
 * 不限于目录行集合）。
 */
export async function readPresetRowsFlat(file: string): Promise<Set<string>> {
  const doc = parseDocument(await readFile(file, 'utf-8'))
  const contents = doc.contents
  if (!isSeq(contents)) throw new Error(`预设文件顶层不是条目列表: ${file}`)
  const rows = new Set<string>()
  walkRows(doc, contents, (_node, id) => {
    rows.add(id)
  })
  return rows
}

/**
 * 使目录 preset 行的 disabled 态与期望一致。
 * - 期望禁用且行存在 → 确保有 `disabled: true` 标量（已有则幂等跳过）；
 * - 期望启用且行存在且 disabled 为标量 true → 删除该键（**!!js 表达式键绝不删**，
 *   平台条件行如 tool-bash 的 win32 gating 保持原样）。
 * 文件里不存在的行忽略（源预设不含该行）。幂等（无变化不写盘）。
 * @returns 是否实际写盘。
 * @throws 顶层非列表 / 落盘失败。
 */
export async function syncPresetRows(
  file: string,
  disabledIds: ReadonlySet<string>,
): Promise<boolean> {
  for (const id of disabledIds) {
    if (!PRESET_ROWS.has(id)) throw new Error(`行 ${id} 不在功能目录 preset 平面集合内，拒绝写入`)
  }
  const text = await readFile(file, 'utf-8')
  const doc = parseDocument(text)
  const contents = doc.contents
  if (!isSeq(contents)) throw new Error(`预设文件顶层不是条目列表: ${file}`)

  let changed = false
  walkRows(doc, contents, (node, id) => {
    if (!PRESET_ROWS.has(id)) return
    const want = disabledIds.has(id)
    const has = node.has('disabled')
    if (want) {
      if (!has) {
        node.set('disabled', true)
        changed = true
      }
    } else if (has && node.get('disabled') === true) {
      node.delete('disabled')
      changed = true
    }
  })

  if (!changed) return false
  await copyFile(file, `${file}.feature-toggle.bak`)
  const tmp = `${file}.feature-toggle.tmp`
  await writeFile(tmp, doc.toString(), 'utf-8')
  await rename(tmp, file)
  return true
}

/** 校验预设文件是「命名插件行列表」（agent-presets 健康检查的本地版）。 */
export function isValidPresetList(text: string): boolean {
  try {
    const doc = parseDocument(text)
    if (!isSeq(doc.contents)) return false
    let named = 0
    visit(doc, {
      Map(_key, node) {
        if (node !== undefined && node.items.length > 0 && node.has('name')) named += 1
      },
    })
    return named > 0
  } catch {
    return false
  }
}
