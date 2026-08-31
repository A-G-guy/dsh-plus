/**
 * profile 用户 patch 文件（cordis.patch.yml）的安全写入。
 * 官方预留的逃生门：用户层支持 id 定向 disabled，覆盖 bundle 层 insert。
 * 写入纪律：先备份、幂等（已禁用跳过）、原子落盘（tmp + rename），失败抛错由调用方告警，
 * 绝不写半个文件、绝不改动既有条目内容。
 *
 * 2026-08-30 事故教训（保险丝必须先于负载可靠）：
 * 1. 并发写竞争：多个插件同一毫秒 FAILED → 多路 appendDisable 共享固定 tmp 名
 *    → rename ENOENT / 读改写丢更新。修复：进程内按文件串行化（promise 链锁）
 *    + tmp 名带 pid/随机后缀。
 * 2. YAML 带错仍强行 stringify：parseDocument 对语法错误不抛而收集进
 *    doc.errors，后续 toString 抛 "Document with errors cannot be stringified"
 *    → 隔离永远写不进去。修复：写前校验 doc.errors；文件已坏时走重建通道
 *    （备份坏文件 → 容错打捞既有 disabled 条目 → 重写干净文档），
 *    隔离落盘优先于保留坏文件。
 * @module lifeboat/patch-file
 */
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'

import { parseDocument } from 'yaml'

/** patch 文件顶层条目（松散视图：只关心 id/disabled/insert 三个键）。 */
export interface PatchEntry {
  id?: string
  disabled?: boolean
  insert?: PatchEntry[]
  [key: string]: unknown
}

/** 条目（含 insert 子列表）中是否已有针对 targetId 的 disabled 覆盖。 */
export function hasDisable(entries: PatchEntry[], targetId: string): boolean {
  for (const entry of entries) {
    if (entry.id === targetId && entry.disabled === true) return true
    if (Array.isArray(entry.insert) && hasDisable(entry.insert, targetId)) return true
  }
  return false
}

/** 顶层条目中已禁用的 id 列表（不含 insert 子列表；用户层 disabled 语义只在顶层）。 */
export function listDisabled(entries: PatchEntry[]): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry.id === 'string' && entry.disabled === true) out.push(entry.id)
  }
  return out
}

/** 进程内按文件串行化：并发隔离写同一 patch 文件时消除读改写竞争。 */
const fileLocks = new Map<string, Promise<unknown>>()

function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(file) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  fileLocks.set(
    file,
    next.catch(() => {}),
  )
  return next
}

/** 唯一 tmp 名（并发/重入不留共享路径），rename 原子落盘。 */
async function atomicWrite(patchFile: string, content: string): Promise<void> {
  const tmp = `${patchFile}.lifeboat.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, patchFile)
}

/**
 * 容错打捞坏 YAML 文本中既有的顶层 disabled 条目（best-effort）：
 * `- id: <name>` 与同条块内的 `disabled: true` 配对即认定。
 * 坏文件里可能躺着此前已隔离的插件——重建时漏掉它们等于重新放行故障插件。
 */
export function salvageDisabled(text: string): string[] {
  const out: string[] = []
  const blockRe = /-\s+id:\s*(\S+)([^\0]*?)(?=\n\s*-\s+id:|$)/g
  for (const match of text.matchAll(blockRe)) {
    const id = match[1]
    const block = match[2] ?? ''
    if (id !== undefined && /\bdisabled:\s*true\b/.test(block)) out.push(id)
  }
  return out
}

/**
 * 重建通道：原文件 YAML 已坏（doc.errors 非空）时的隔离写入。
 * 备份坏文件（保留现场）→ 打捞既有 disabled → 重写干净文档。
 * 即使目标已在打捞集中也照样重写——坏文件对 loader 等于不存在，
 * 修复文件本身与写入禁用同等重要；返回值仅报告目标集合是否变化。
 */
async function appendDisableRebuild(
  patchFile: string,
  text: string,
  targetId: string,
): Promise<boolean> {
  const salvaged = salvageDisabled(text)
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  await copyFile(patchFile, `${patchFile}.broken-${stamp}.bak`)
  const ids = salvaged.includes(targetId) ? salvaged : [...salvaged, targetId]
  const entries = ids.map((id) => `- id: ${id}\n  disabled: true`)
  const content = [
    '# 本文件由 lifeboat 重建：原文件存在 YAML 语法错误，无法安全改写。',
    `# 原件已备份为同目录 .broken-${stamp}.bak，请人工合并残留自定义条目。`,
    ...entries,
    '',
  ].join('\n')
  await atomicWrite(patchFile, content)
  return !salvaged.includes(targetId)
}

/**
 * 向 patch 文件追加一条禁用覆盖；返回是否实际写入（已存在禁用则跳过）。
 * 原文件 YAML 已坏时转重建通道（隔离落盘优先，原件备份待人工合并）。
 * @throws 文件不可读/顶层不是数组/落盘失败——调用方负责告警。
 */
export async function appendDisable(patchFile: string, targetId: string): Promise<boolean> {
  return withFileLock(patchFile, async () => {
    const text = await readFile(patchFile, 'utf-8')
    const doc = parseDocument(text)
    if (doc.errors.length > 0) return appendDisableRebuild(patchFile, text, targetId)
    const root = doc.toJS() as unknown
    if (!Array.isArray(root)) throw new Error(`patch 文件顶层不是数组: ${patchFile}`)
    if (hasDisable(root as PatchEntry[], targetId)) return false
    await copyFile(patchFile, `${patchFile}.lifeboat.bak`)
    doc.add({ id: targetId, disabled: true })
    await atomicWrite(patchFile, doc.toString())
    return true
  })
}

/**
 * 从 patch 文件移除针对 targetId 的禁用覆盖（恢复插件）；返回是否实际写入。
 * 只移除「id 定向且 disabled: true」的行，其余内容（注释经 yaml 文档保留、
 * 其他条目）原样不动；无该覆盖时幂等返回 false。
 * 原文件 YAML 已坏时不猜测改写，抛错指引人工处理（恢复操作有使用者在场）。
 * @throws 文件不可读/顶层不是数组/YAML 语法错误/落盘失败——调用方负责告警。
 */
export async function removeDisable(patchFile: string, targetId: string): Promise<boolean> {
  return withFileLock(patchFile, async () => {
    const text = await readFile(patchFile, 'utf-8')
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      throw new Error(`patch 文件存在 YAML 语法错误，请人工修复后重试: ${patchFile}`)
    }
    const root = doc.toJS() as unknown
    if (!Array.isArray(root)) throw new Error(`patch 文件顶层不是数组: ${patchFile}`)
    let removed = false
    const items = doc.contents
    if (items?.items !== undefined && Array.isArray(items.items)) {
      // 头注释挂在首个条目的 commentBefore 上：被移除项若为首项，注释迁移给
      // 新的首项，避免整文件头注释丢失。
      const headComment = (items.items[0] as unknown as { commentBefore?: string })?.commentBefore
      doc.contents.items = items.items.filter((item) => {
        const value = (item as unknown as { toJS?(doc: unknown): unknown }).toJS?.(doc) as
          | PatchEntry
          | undefined
        if (
          value !== undefined &&
          typeof value === 'object' &&
          value.id === targetId &&
          value.disabled === true
        ) {
          removed = true
          return false
        }
        return true
      })
      if (removed && headComment !== undefined && doc.contents.items.length > 0) {
        const next = doc.contents.items[0] as unknown as { commentBefore?: string }
        if (next.commentBefore === undefined) next.commentBefore = headComment
      }
    }
    if (!removed) return false
    await copyFile(patchFile, `${patchFile}.lifeboat.bak`)
    await atomicWrite(patchFile, doc.toString())
    return true
  })
}
