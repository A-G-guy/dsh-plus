/**
 * profile 用户 patch 文件（cordis.patch.yml）的安全写入。
 * 官方预留的逃生门：用户层支持 id 定向 disabled，覆盖 bundle 层 insert。
 * 写入纪律：先备份、幂等（已禁用跳过）、原子落盘（tmp + rename），失败抛错由调用方告警，
 * 绝不写半个文件、绝不改动既有条目内容。
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

/**
 * 向 patch 文件追加一条禁用覆盖；返回是否实际写入（已存在禁用则跳过）。
 * @throws 文件不可读/顶层不是数组/落盘失败——调用方负责告警。
 */
export async function appendDisable(patchFile: string, targetId: string): Promise<boolean> {
  const text = await readFile(patchFile, 'utf-8')
  const doc = parseDocument(text)
  const root = doc.toJS() as unknown
  if (!Array.isArray(root)) throw new Error(`patch 文件顶层不是数组: ${patchFile}`)
  if (hasDisable(root as PatchEntry[], targetId)) return false
  await copyFile(patchFile, `${patchFile}.lifeboat.bak`)
  doc.add({ id: targetId, disabled: true })
  const tmp = `${patchFile}.lifeboat.tmp`
  await writeFile(tmp, doc.toString(), 'utf-8')
  await rename(tmp, patchFile)
  return true
}
