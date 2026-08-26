/**
 * 面板偏好的服务端持久化：JSON 单文件落盘（默认
 * `~/.dsh/web-files/prefs.json`），供全部设备共享（跨设备记忆）。
 *
 * 与 HTTP 层解耦以便单测（路径经构造器注入）；所有外部输入在本模块
 * 边界校验，损坏/越界数据静默回退默认项而非整文件作废。
 * @module @dsh-plus/web-files/prefs
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'

import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

import { FilesError, requireAbsolute } from './fs-core.ts'
import {
  type DirSortPreference,
  PREFS_SORT_MAX_DIRS,
  type PrefsPatchRequest,
  SORT_KEYS,
  type SortDir,
  type WebFilesPrefsDto,
} from './protocol.ts'

/** 缺省偏好（与历史行为一致：隐藏文件不展示、名称升序）。 */
export function defaultPrefs(): WebFilesPrefsDto {
  return { showHidden: false, sortByDir: {} }
}

function isSortDir(value: unknown): value is SortDir {
  return value === 'asc' || value === 'desc'
}

function isSortKey(value: unknown): boolean {
  return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value)
}

/** 单条排序偏好校验：键/方向合法且目录为绝对路径才保留。 */
function toSortPreference(value: unknown): DirSortPreference | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!isSortKey(record['key']) || !isSortDir(record['dir'])) return undefined
  return { key: record['key'] as DirSortPreference['key'], dir: record['dir'] }
}

/**
 * 清洗任意来源（磁盘/补丁）的偏好数据：非法字段丢弃，
 * 排序表逐条校验并截断到 {@link PREFS_SORT_MAX_DIRS}（保留末尾新条目）。
 */
export function sanitizePrefs(raw: unknown): WebFilesPrefsDto {
  const prefs = defaultPrefs()
  if (typeof raw !== 'object' || raw === null) return prefs
  const record = raw as Record<string, unknown>
  if (typeof record['showHidden'] === 'boolean') prefs.showHidden = record['showHidden']
  const sortRaw = record['sortByDir']
  if (typeof sortRaw !== 'object' || sortRaw === null) return prefs
  const entries: Array<readonly [string, DirSortPreference]> = []
  for (const [path, rawValue] of Object.entries(sortRaw as Record<string, unknown>)) {
    if (!isAbsolute(path)) continue
    const value = toSortPreference(rawValue)
    if (value !== undefined) entries.push([path, value])
  }
  for (const [path, value] of entries.slice(-PREFS_SORT_MAX_DIRS)) {
    prefs.sortByDir[path] = value
  }
  return prefs
}

/** 校验合并补丁（外部边界）；sortFor.path 复用绝对路径校验。 */
export function requirePrefsPatch(raw: unknown): PrefsPatchRequest {
  if (typeof raw !== 'object' || raw === null) {
    throw new FilesError('prefs patch must be an object', 'path-invalid')
  }
  const record = raw as Record<string, unknown>
  const patch: PrefsPatchRequest = {}
  if (record['showHidden'] !== undefined) {
    if (typeof record['showHidden'] !== 'boolean') {
      throw new FilesError('showHidden must be a boolean', 'path-invalid')
    }
    patch.showHidden = record['showHidden']
  }
  if (record['sortFor'] !== undefined) {
    const sortFor = record['sortFor'] as Record<string, unknown> | null
    const value = typeof sortFor === 'object' && sortFor !== null ? sortFor['value'] : undefined
    const preference = toSortPreference(value)
    if (preference === undefined) {
      throw new FilesError('sortFor.value must be a valid sort preference', 'path-invalid')
    }
    patch.sortFor = {
      path: requireAbsolute(sortFor?.['path']),
      value: preference,
    }
  }
  return patch
}

/**
 * 偏好存储：读改写串行化（内存队列），tmp+rename 原子落盘。
 * 文件缺失或损坏时返回默认值（下次 patch 时自愈重写）。
 */
export class PrefsStore {
  readonly path: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(path: string = dshHomePath('web-files', 'prefs.json')) {
    this.path = path
  }

  async read(): Promise<WebFilesPrefsDto> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch {
      return defaultPrefs()
    }
    try {
      return sanitizePrefs(JSON.parse(raw))
    } catch {
      return defaultPrefs()
    }
  }

  /** 合并补丁并落盘，返回合并后的完整偏好。 */
  async patch(patch: PrefsPatchRequest): Promise<WebFilesPrefsDto> {
    const run = this.queue.then(() => this.applyPatch(patch))
    this.queue = run.catch(() => {})
    return run
  }

  private async applyPatch(patch: PrefsPatchRequest): Promise<WebFilesPrefsDto> {
    const prefs = await this.read()
    if (patch.showHidden !== undefined) prefs.showHidden = patch.showHidden
    if (patch.sortFor !== undefined) {
      // 重插到末尾：对象键序即最近更新序，超限时逐出最久未更新项
      const { path, value } = patch.sortFor
      const entries = Object.entries(prefs.sortByDir).filter(([key]) => key !== path)
      entries.push([path, value])
      prefs.sortByDir = Object.fromEntries(entries.slice(-PREFS_SORT_MAX_DIRS))
    }
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.web-files-${String(process.pid)}-${String(Date.now())}.tmp`
    await writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`, 'utf8')
    await rename(tmp, this.path)
    return prefs
  }
}
