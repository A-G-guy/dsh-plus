/**
 * 预算缓存状态：与官方 CLI 逐字同构的 `<dataDir>/.actual-cli/<syncId>/state.json`，
 * 目的是**共用同一份缓存**（官方下过就不必再下），而不是各存一份。
 *
 * 读失败（缺失/损坏/结构不符）一律视为「无状态」，由调用方决定重新下载；
 * 写失败静默忽略——缓存只是优化，不能影响命令结果（与官方一致）。
 * @module @dsh-plus/actual-reports/cache
 */

import { joinPath, type ReportsIo } from './node-io.ts'

/** 状态文件名（协议的一部分）。 */
const STATE_FILE_NAME = 'state.json'

/** 与官方同构的缓存状态。 */
export interface CacheState {
  version: 1
  syncId: string
  budgetId: string
  serverUrl: string
  lastSyncedAt: number
  lastDownloadedAt: number
}

/** 状态文件路径。 */
export function cachePathOf(metaDir: string): string {
  return joinPath(metaDir, STATE_FILE_NAME)
}

/** 结构校验（不满足即当无状态）。 */
function isCacheState(value: unknown): value is CacheState {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.version === 1 &&
    typeof record.syncId === 'string' &&
    typeof record.budgetId === 'string' &&
    typeof record.serverUrl === 'string' &&
    typeof record.lastSyncedAt === 'number' &&
    typeof record.lastDownloadedAt === 'number'
  )
}

/** 读缓存状态；缺失/损坏返回 undefined。 */
export async function readCacheState(
  metaDir: string,
  io: ReportsIo,
): Promise<CacheState | undefined> {
  const raw = await io.fs.readText(cachePathOf(metaDir)).catch(() => undefined)
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return isCacheState(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 写缓存状态；失败静默（缓存不参与正确性）。 */
export async function writeCacheState(
  metaDir: string,
  state: CacheState,
  io: ReportsIo,
): Promise<void> {
  await io.fs.writeTextAtomic(cachePathOf(metaDir), JSON.stringify(state)).catch(() => undefined)
}

/** 下一步动作：首次/失配 → download；写操作或过期 → sync；其余 → skip（用缓存）。 */
export type SyncDecision = { action: 'download' } | { action: 'sync' | 'skip'; state: CacheState }

/** 决策输入。 */
export interface DecisionInput {
  state: CacheState | undefined
  syncId: string
  serverUrl: string
  now: number
  ttlMs: number
  mutates: boolean
  /** 端到端加密预算必须走 downloadBudget（官方同处理）。 */
  encrypted: boolean
}

/**
 * 决定本次连接如何拿到预算（与官方 `decideSyncAction` 同语义）。
 */
export function decideSyncAction(input: DecisionInput): SyncDecision {
  const { state, now, ttlMs } = input
  if (state === undefined) return { action: 'download' }
  if (state.syncId !== input.syncId) return { action: 'download' }
  if (state.serverUrl !== input.serverUrl) return { action: 'download' }
  if (input.mutates || ttlMs === 0 || input.encrypted) return { action: 'sync', state }
  const age = now - state.lastSyncedAt
  if (age < 0) return { action: 'sync', state }
  return age < ttlMs ? { action: 'skip', state } : { action: 'sync', state }
}
