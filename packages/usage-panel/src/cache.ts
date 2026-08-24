/**
 * 用量缓存：`$DSH_HOME/usage-panel/cache.json`（schema v1）。
 * `{version, sessions: {[id]: {lastSeq, rows[]}}}`——lastSeq 短路免重扫、
 * 原子写（临时文件 + rename）、损坏降级为全量重建。
 * @module usage-panel/cache
 */
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { UsageRow } from './usage-fold.ts'

export const CACHE_VERSION = 1

export interface SessionCacheEntry {
  lastSeq: number
  rows: UsageRow[]
}

export interface UsageCache {
  version: number
  sessions: Record<string, SessionCacheEntry>
}

export const EMPTY_CACHE: UsageCache = { version: CACHE_VERSION, sessions: {} }

interface CacheRow {
  date?: unknown
  provider?: unknown
  model?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  cacheReadTokens?: unknown
  cacheWriteTokens?: unknown
  calls?: unknown
}

function coerceRow(raw: CacheRow): UsageRow | null {
  const count = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : (null as never)
  if (
    typeof raw.date !== 'string' ||
    typeof raw.provider !== 'string' ||
    typeof raw.model !== 'string'
  ) {
    return null
  }
  const inputTokens = count(raw.inputTokens)
  const outputTokens = count(raw.outputTokens)
  const cacheReadTokens = count(raw.cacheReadTokens)
  const cacheWriteTokens = count(raw.cacheWriteTokens)
  const calls = count(raw.calls)
  if (
    inputTokens === null ||
    outputTokens === null ||
    cacheReadTokens === null ||
    cacheWriteTokens === null ||
    calls === null
  ) {
    return null
  }
  return {
    date: raw.date,
    provider: raw.provider,
    model: raw.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    calls,
  }
}

/** 解析缓存文件；损坏/版本不符 → null（调用方降级为空缓存全量重建）。 */
export function parseCache(text: string): UsageCache | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const doc = parsed as { version?: unknown; sessions?: unknown }
  if (
    doc.version !== CACHE_VERSION ||
    typeof doc.sessions !== 'object' ||
    doc.sessions === null ||
    Array.isArray(doc.sessions)
  ) {
    return null
  }
  const sessions: Record<string, SessionCacheEntry> = {}
  for (const [id, entry] of Object.entries(doc.sessions as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as { lastSeq?: unknown; rows?: unknown }
    if (typeof e.lastSeq !== 'number' || !Array.isArray(e.rows)) continue
    const rows: UsageRow[] = []
    for (const raw of e.rows) {
      const row = coerceRow(raw as CacheRow)
      if (row !== null) rows.push(row)
    }
    sessions[id] = { lastSeq: e.lastSeq, rows }
  }
  return { version: CACHE_VERSION, sessions }
}

/** 读取缓存文件；缺失/损坏 → 空缓存（全量重建语义）。 */
export async function loadCache(path: string): Promise<UsageCache> {
  if (!existsSync(path)) return { ...EMPTY_CACHE, sessions: {} }
  try {
    return parseCache(await readFile(path, 'utf8')) ?? { ...EMPTY_CACHE, sessions: {} }
  } catch {
    return { ...EMPTY_CACHE, sessions: {} }
  }
}

/** 原子写缓存（同目录临时文件 + rename）。 */
export async function saveCache(path: string, cache: UsageCache): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(cache), 'utf8')
  try {
    await rename(tmp, path)
  } catch (error) {
    // Windows/并发 rename 失败兜底：直接写目标（保持简单，本地场景 rename 几乎必成）。
    await writeFile(path, JSON.stringify(cache), 'utf8').catch(() => {
      throw error
    })
  }
}

/** 合并同一会话的旧 rows 与新增 rows（同键桶内累加）。 */
export function mergeRows(oldRows: readonly UsageRow[], newRows: readonly UsageRow[]): UsageRow[] {
  const buckets = new Map<string, UsageRow>()
  const push = (row: UsageRow): void => {
    const key = `${row.date}\u0000${row.provider}\u0000${row.model}`
    const current = buckets.get(key)
    if (current === undefined) {
      buckets.set(key, { ...row })
      return
    }
    current.inputTokens += row.inputTokens
    current.outputTokens += row.outputTokens
    current.cacheReadTokens += row.cacheReadTokens
    current.cacheWriteTokens += row.cacheWriteTokens
    current.calls += row.calls
  }
  for (const row of oldRows) push(row)
  for (const row of newRows) push(row)
  return [...buckets.values()].sort((a, b) =>
    a.date === b.date
      ? a.provider === b.provider
        ? a.model.localeCompare(b.model)
        : a.provider.localeCompare(b.provider)
      : a.date.localeCompare(b.date),
  )
}

/** 目录存在性守卫（saveCache 前确保父目录）。 */
export async function ensureDirFor(
  path: string,
  mkdir: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = dirname(path)
  if (!existsSync(dir)) await mkdir(dir)
}
