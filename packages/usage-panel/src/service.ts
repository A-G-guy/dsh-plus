/**
 * usage-panel 服务主体：
 * - 实时通道：root ctx 订阅 session/event，活跃会话增量折叠；
 * - 历史通道：自动增量同步（启动 + 定时；persistence list 快照 revision/
 *   lastSeq 双重短路，只 open + 读尾部增量，无手动扫描）；
 * - 目录：models.dev 后台拉取（启动 + 定时），失败沿用磁盘缓存；
 * - 端点：GET data / GET|POST catalog / POST prices-import（同源 webServer）。
 * @module usage-panel/service
 */
import { mkdir } from 'node:fs/promises'
import { type Context, Service } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import { registerUsageApi } from './api.ts'
import {
  EMPTY_CACHE,
  ensureDirFor,
  loadCache,
  mergeRows,
  saveCache,
  type UsageCache,
} from './cache.ts'
import { CatalogStore } from './catalog.ts'
import { Config, SETTINGS_NS, type UsagePanelConfig } from './config.ts'
import { importPrices } from './models-dev.ts'
import { estimateCost, type PriceTable } from './pricing.ts'
import { type PersistenceLike, planSync, TAIL_BATCH_LIMIT } from './sync-runner.ts'
import { foldUsage, type UsageRow } from './usage-fold.ts'

/** 服务时区偏移（分钟）：展示口径取服务器本地时区，与用户感知一致。 */
function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

interface SessionLike {
  id: string
  events: readonly unknown[]
}

/** 同步进度（端点投影）。 */
export interface SyncState {
  total: number
  done: number
  skipped: number
  lastError: string | null
  lastFinishedAt: string | null
  running: boolean
}

const IDLE_SYNC: SyncState = {
  total: 0,
  done: 0,
  skipped: 0,
  lastError: null,
  lastFinishedAt: null,
  running: false,
}

/** 自动同步定时器周期下限（分钟）：防呆，间隔过小时按此值节流。 */
const MIN_INTERVAL_MINUTES = 1

export class UsagePanelService extends Service {
  static inject = ['sessions']

  private readonly cachePath = dshHomePath('usage-panel', 'cache.json')
  private readonly catalogPath = dshHomePath('usage-panel', 'models-dev.json')
  private cache: UsageCache = { ...EMPTY_CACHE, sessions: {} }
  private current: () => UsagePanelConfig
  private syncState: SyncState = { ...IDLE_SYNC }
  private syncAbort: AbortController | null = null
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private catalogTimer: ReturnType<typeof setTimeout> | null = null
  private catalog: CatalogStore | null = null
  /** settings 服务引用（installSection 注入时捕获；端点写入用户层用）。 */
  private settingsRef: {
    get(ns: string): unknown
    update(ns: string, patch: Record<string, unknown>): Promise<void>
  } | null = null

  constructor(ctx: Context, config: UsagePanelConfig) {
    super(ctx, 'usagePanel')
    this.current = () => config
    // 官方 installSection 范式（0.1.2-alpha.2）：settings 在时以行级 config 为
    // base 注册用户层，缺席/detach 时回落行级 config。
    ctx.inject(['settings'], (settingsCtx) => {
      this.settingsRef = settingsCtx.settings as unknown as NonNullable<typeof this.settingsRef>
      settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
        setSource: (source) => {
          this.current = source
          this.applyConfig()
        },
        onChange: () => {},
      })
    })
    void this.boot()
    // 实时通道：root 上的会话事件（新事件即时折叠进对应会话桶）。
    ctx.root.on('session/event', (session, event) => {
      const live: SessionLike = { id: session.id, events: [] }
      this.ingestLive(live, [event])
    })
    ctx.inject(['webServer'], (webCtx) => {
      registerUsageApi(webCtx as Context, this)
    })
  }

  private async boot(): Promise<void> {
    await ensureDirFor(this.cachePath, async (dir) => {
      await mkdir(dir, { recursive: true })
    })
    this.cache = await loadCache(this.cachePath)
    const config = this.current()
    this.catalog = new CatalogStore(
      this.catalogPath,
      {
        url: 'https://models.dev/api.json',
        proxy: config.catalogProxy,
        timeoutMs: 20_000,
        maxBytes: 20 * 1024 * 1024,
      },
      config.catalogRefreshHours,
      (message) => this.ctx.logger('usage-panel').warn(message),
    )
    // 目录后台拉取（失败不影响任何通道）。
    void this.catalog.ensureLoaded().then(() => this.scheduleCatalog(config.catalogRefreshHours))
    // 历史增量同步：启动一次 + 按配置周期自动执行。
    await this.runSync()
    this.scheduleSync(config.autoSyncMinutes)
  }

  /** 配置热更：重设目录参数与同步周期。 */
  private applyConfig(): void {
    const config = this.current()
    this.catalog?.reconfigure(
      {
        url: 'https://models.dev/api.json',
        proxy: config.catalogProxy,
        timeoutMs: 20_000,
        maxBytes: 20 * 1024 * 1024,
      },
      config.catalogRefreshHours,
    )
    this.scheduleCatalog(config.catalogRefreshHours)
    this.scheduleSync(config.autoSyncMinutes)
  }

  /** 目录自动刷新定时（0 = 仅启动时一次）。 */
  private scheduleCatalog(hours: number): void {
    if (this.catalogTimer !== null) {
      clearTimeout(this.catalogTimer)
      this.catalogTimer = null
    }
    if (hours <= 0 || this.catalog === null) return
    this.catalogTimer = setTimeout(() => {
      this.catalogTimer = null
      void this.catalog
        ?.refresh()
        .then(() => this.scheduleCatalog(this.current().catalogRefreshHours))
    }, Math.max(1, hours) * 3_600_000)
  }

  /** 历史同步定时（0 = 仅启动时一次；进行中的轮次不重叠）。 */
  private scheduleSync(minutes: number): void {
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer)
      this.syncTimer = null
    }
    if (minutes <= 0) return
    const interval = Math.max(minutes, MIN_INTERVAL_MINUTES) * 60_000
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      void this.runSync().then(() => this.scheduleSync(this.current().autoSyncMinutes))
    }, interval)
  }

  /** persistence 服务投影（缺席返回 null，结构化降级为仅实时通道）。 */
  private persistence(): PersistenceLike | null {
    const found = (this.ctx as unknown as { get(key: 'sessionPersistence'): unknown }).get?.(
      'sessionPersistence',
    )
    if (found === undefined || found === null) return null
    return found as PersistenceLike
  }

  /** 实时增量：单会话新事件 → 差量行 → 合并缓存（不落盘；同步完成时持久化）。 */
  private ingestLive(session: SessionLike, events: readonly unknown[]): void {
    const entry = this.cache.sessions[session.id]
    const lastSeq = entry?.lastSeq ?? -1
    const fresh = events.filter((e) => {
      const seq = (e as { seq?: unknown }).seq
      return typeof seq === 'number' && seq > lastSeq
    })
    if (fresh.length === 0) return
    const maxSeq = Math.max(lastSeq, ...fresh.map((e) => (e as { seq: number }).seq))
    const delta = foldUsage(fresh as never[], localTzOffsetMinutes())
    if (delta.length === 0 && entry !== undefined) {
      this.cache.sessions[session.id] = { ...entry, lastSeq: maxSeq }
      return
    }
    this.cache.sessions[session.id] = {
      ...(entry?.revision !== undefined ? { revision: entry.revision } : {}),
      lastSeq: maxSeq,
      rows: mergeRows(entry?.rows ?? [], delta),
    }
  }

  /**
   * 自动增量同步一轮：list 快照 → planSync 规划 → 逐会话 open('read') +
   * 从 lastSeq 读尾部 → 差量折叠合并。revision 命中短路零 open。
   * 失败只记状态（lastError），不中断下一轮调度。
   */
  async runSync(): Promise<void> {
    if (this.syncState.running) return
    const persistence = this.persistence()
    if (persistence === null) {
      this.syncState = { ...IDLE_SYNC, lastError: 'persistence-unavailable' }
      return
    }
    this.syncAbort = new AbortController()
    const signal = this.syncAbort.signal
    const state: SyncState = { ...IDLE_SYNC, running: true }
    this.syncState = state
    try {
      const snapshots = await persistence.list({ signal })
      const plan = planSync(snapshots, this.cache)
      state.total = plan.filter((item) => item.action !== 'skip').length
      state.skipped = plan.length - state.total
      for (const item of plan) {
        if (signal.aborted) break
        if (item.action === 'skip') continue
        try {
          const fromSeq = item.action === 'tail' ? (item.fromSeq ?? 0) : 0
          await this.syncSession(persistence, item.id, fromSeq, signal)
        } catch (error) {
          // 单会话损坏/占用不拖垮整轮；快照 revision 未写入，下轮重试。
          state.lastError = `${item.id}: ${error instanceof Error ? error.message : String(error)}`
          this.ctx.logger('usage-panel').warn(`sync session failed: ${state.lastError}`)
        }
        state.done += 1
      }
      await this.flush()
      state.lastFinishedAt = new Date().toISOString()
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error)
      this.ctx.logger('usage-panel').warn(`sync round failed: ${state.lastError}`)
    } finally {
      state.running = false
      this.syncState = { ...state, running: false }
      this.syncAbort = null
    }
  }

  /** 单会话增量：read handle 按 offset 读取，差量折叠合并进缓存。 */
  private async syncSession(
    persistence: PersistenceLike,
    id: string,
    fromSeq: number,
    signal: AbortSignal,
  ): Promise<void> {
    const handle = await persistence.open(id, 'read', { signal })
    try {
      let offset = fromSeq
      let maxSeq = fromSeq - 1
      for (;;) {
        const { events } = await handle.read(offset, TAIL_BATCH_LIMIT, { signal })
        if (events.length === 0) break
        const entry = this.cache.sessions[id]
        const delta = foldUsage(events as never[], localTzOffsetMinutes())
        const lastEvent = events.at(-1) as { seq?: unknown } | undefined
        const batchMax = typeof lastEvent?.seq === 'number' ? lastEvent.seq : maxSeq
        maxSeq = Math.max(maxSeq, batchMax)
        this.cache.sessions[id] = {
          ...(entry?.revision !== undefined ? { revision: entry.revision } : {}),
          lastSeq: Math.max(entry?.lastSeq ?? -1, maxSeq),
          rows: mergeRows(entry?.rows ?? [], delta),
        }
        if (events.length < TAIL_BATCH_LIMIT) break
        offset = maxSeq + 1
      }
      // 本轮快照 revision 在 list 时取得：syncSession 无快照上下文时保留旧值，
      // 由调用方统一在 planSync 前比对——此处不写 revision（保守，宁多读不漏读）。
    } finally {
      await handle.close()
    }
  }

  /** 全量行（所有会话合并）。 */
  allRows(): UsageRow[] {
    const merged = new Map<string, UsageRow>()
    for (const entry of Object.values(this.cache.sessions)) {
      for (const row of entry.rows) {
        const key = `${row.date}\u0000${row.provider}\u0000${row.model}`
        const current = merged.get(key)
        if (current === undefined) {
          merged.set(key, { ...row })
          continue
        }
        current.inputTokens += row.inputTokens
        current.outputTokens += row.outputTokens
        current.cacheReadTokens += row.cacheReadTokens
        current.cacheWriteTokens += row.cacheWriteTokens
        current.calls += row.calls
      }
    }
    return [...merged.values()].sort((a, b) =>
      a.date === b.date
        ? a.provider === b.provider
          ? a.model.localeCompare(b.model)
          : a.provider.localeCompare(b.provider)
        : a.date.localeCompare(b.date),
    )
  }

  priceTable(): PriceTable {
    const config = this.current()
    return { currency: config.currency, entries: config.prices }
  }

  syncProgress(): SyncState {
    return this.syncState
  }

  catalogState() {
    return this.catalog?.status() ?? { fetchedAt: null, error: null, refreshing: false }
  }

  /** 目录源（端点手动刷新用；boot 完成前为 null）。 */
  catalogStore(): CatalogStore | null {
    return this.catalog
  }

  sessionCount(): number {
    return Object.keys(this.cache.sessions).length
  }

  /** 持久化当前缓存（失败只告警不影响服务）。 */
  async flush(): Promise<void> {
    try {
      await ensureDirFor(this.cachePath, async (dir) => {
        await mkdir(dir, { recursive: true })
      })
      await saveCache(this.cachePath, this.cache)
    } catch (error) {
      this.ctx
        .logger('usage-panel')
        .warn(`cache flush failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * models.dev 导入价目（从已缓存文档折算，写入 settings 用户层，返回导入条数）。
   * settings 服务缺席（极端 headless）→ settings-unavailable 结构化错误。
   */
  async importFromModelsDev(docText: string | null): Promise<number> {
    const doc = docText !== null ? (JSON.parse(docText) as Record<string, unknown>) : null
    const source = doc ?? this.catalog?.getDocument()
    if (source === null || source === undefined) {
      throw new Error('catalog-unavailable')
    }
    const settings = this.settingsRef
    if (settings === null) throw new Error('settings-unavailable')
    const entries = importPrices(source as never)
    const current = settings.get(SETTINGS_NS) as { prices?: unknown[] } | undefined
    await settings.update(SETTINGS_NS, { prices: entries })
    if (current !== undefined && typeof current !== 'object') {
      this.ctx.logger('usage-panel').warn('settings ns shape unexpected; prices overwritten')
    }
    return entries.length
  }

  /** 一行费用估算（端点投影用）。 */
  rowCost(row: UsageRow): number | null {
    return estimateCost(row, this.priceTable())
  }

  dispose(): void {
    this.syncAbort?.abort()
    if (this.syncTimer !== null) clearTimeout(this.syncTimer)
    if (this.catalogTimer !== null) clearTimeout(this.catalogTimer)
    void this.flush()
  }
}
