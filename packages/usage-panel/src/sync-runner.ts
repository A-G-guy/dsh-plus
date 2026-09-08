/**
 * 自动增量同步：由 persistence 快照（list/stat）规划每会话的最小读取，
 * 再用 read handle 从 lastSeq 起读尾部增量。规划是纯函数（可测），执行器
 * 只做 IO 编排。空扫描策略：无新会话时零 `open` 调用。
 * @module usage-panel/sync-runner
 */
import type { SessionCacheEntry, UsageCache } from './cache.ts'

/** persistence 快照投影（SessionPersistenceSnapshot 的最窄面）。 */
export interface SnapshotLike {
  header: { id: string; createdAt?: number }
  revision?: string
  eventCount?: number
}

/** 每会话的读取计划。 */
export interface SyncPlanItem {
  id: string
  /** 'full' 全量读（新会话/revision 变化/revision 缺失）；'tail' 从 fromSeq 读尾部；'skip' 无需读。 */
  action: 'full' | 'tail' | 'skip'
  /** 'tail' 的起点（上次同步到的 lastSeq）。 */
  fromSeq?: number
}

/** 同步计划（纯函数）：对齐缓存决定每会话动作。 */
export function planSync(snapshots: readonly SnapshotLike[], cache: UsageCache): SyncPlanItem[] {
  return snapshots.map((snapshot) => {
    const id = snapshot.header.id
    const entry: SessionCacheEntry | undefined = cache.sessions[id]
    // revision 一致 → 日志未变，直接跳过（零 IO）。
    if (
      entry !== undefined &&
      entry.revision !== undefined &&
      snapshot.revision !== undefined &&
      entry.revision === snapshot.revision
    ) {
      return { id, action: 'skip' as const }
    }
    // 无 revision 可比（后端未提供或首次见）：用 lastSeq 增量读尾部。
    if (entry !== undefined && entry.lastSeq >= 0) {
      return { id, action: 'tail' as const, fromSeq: entry.lastSeq + 1 }
    }
    return { id, action: 'full' as const }
  })
}

/** 读取句柄投影（SessionHandle 的最窄面）。 */
export interface ReadHandleLike {
  read(
    offset?: number,
    length?: number,
    options?: { signal?: AbortSignal },
  ): Promise<{
    events: readonly unknown[]
  }>
  close(): Promise<void>
}

/** persistence 服务投影（本插件用到的最小面）。 */
export interface PersistenceLike {
  list(options?: { signal?: AbortSignal }): Promise<readonly SnapshotLike[]>
  open(id: string, access: 'read', options?: { signal?: AbortSignal }): Promise<ReadHandleLike>
}

/** 读取上限护栏：单次 tail 拉取的事件数上限（异常膨胀时切断，下轮续传）。 */
export const TAIL_BATCH_LIMIT = 20_000

/** 从缓存折叠出的行尾 seq（cache entry 中实际最大已消费 seq）。 */
export function entryEndSeq(entry: SessionCacheEntry | undefined): number {
  return entry?.lastSeq ?? -1
}
