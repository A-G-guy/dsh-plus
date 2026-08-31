/**
 * usage-panel 服务主体：
 * - 实时通道：root ctx 订阅 session/event，活跃会话增量折叠；
 * - 历史通道：手动触发的扫描任务（sessionPersistence.list + load + lastSeq 缓存短路）；
 * - 端点：GET data / POST scan / POST prices-import（同源 webServer）。
 * @module usage-panel/service
 */
import { mkdir } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
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
import { Config, SETTINGS_NS, type UsagePanelConfig } from './config.ts'
import { type ImportedPrice, importPrices } from './models-dev.ts'
import { estimateCost, type PriceTable } from './pricing.ts'
import { foldUsage, type UsageRow } from './usage-fold.ts'

/** 服务时区偏移（分钟）：展示口径取服务器本地时区，与用户感知一致。 */
function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

interface SessionLike {
  id: string
  events: readonly unknown[]
}

export class UsagePanelService extends Service {
  static [Context.inject] = ['sessions']

  private readonly cachePath = dshHomePath('usage-panel', 'cache.json')
  private cache: UsageCache = { ...EMPTY_CACHE, sessions: {} }
  private current: () => UsagePanelConfig
  private scanning: { total: number; done: number } | null = null
  private scanAbort: AbortController | null = null

  constructor(ctx: Context, config: UsagePanelConfig) {
    super(ctx, 'usagePanel')
    this.current = () => config
    // 官方 installSection 范式（0.1.2-alpha.2）：settings 在时以行级 config 为
    // base 注册用户层，缺席/detach 时回落行级 config。
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
        setSource: (source) => {
          this.current = source
        },
        onChange: () => {},
      })
    })
    void this.boot()
    // 实时通道：root 上的会话事件（新事件即时折叠进对应会话桶）。
    ctx.root.on('session/event', (session: Session, event: SessionEvent) => {
      this.ingestLive(session, [event])
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
  }

  /** 实时增量：单会话新事件 → 差量行 → 合并缓存（不落盘；扫描/定期时持久化）。 */
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
      lastSeq: maxSeq,
      rows: mergeRows(entry?.rows ?? [], delta),
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

  /** 扫描进度（null = 空闲）。 */
  scanState(): { total: number; done: number } | null {
    return this.scanning
  }

  sessionCount(): number {
    return Object.keys(this.cache.sessions).length
  }

  /** 触发历史扫描（sessionPersistence 缺席 → 结构化拒绝）。 */
  async startScan(): Promise<{ ok: boolean; error?: string }> {
    if (this.scanning !== null) return { ok: false, error: 'scan-in-progress' }
    const persistence = (
      this.ctx as unknown as {
        get(key: 'sessionPersistence'): unknown
      }
    ).get?.('sessionPersistence')
    if (persistence === undefined || persistence === null) {
      return { ok: false, error: 'persistence-unavailable' }
    }
    const api = persistence as {
      list(signal?: AbortSignal): Promise<Array<{ id: string }>>
      load(id: string): Promise<{ events: readonly unknown[] }>
    }
    this.scanAbort = new AbortController()
    const signal = this.scanAbort.signal
    void (async () => {
      try {
        await this.boot()
        const headers = await api.list(signal)
        this.scanning = { total: headers.length, done: 0 }
        for (const header of headers) {
          if (signal.aborted) break
          try {
            const { events } = await api.load(header.id)
            this.applyScanEvents(header.id, events)
          } catch {
            // 单会话损坏不拖垮整个扫描；跳过。
          }
          this.scanning = { total: this.scanning.total, done: this.scanning.done + 1 }
        }
        await saveCache(this.cachePath, this.cache)
      } finally {
        this.scanning = null
        this.scanAbort = null
      }
    })()
    return { ok: true }
  }

  /** 扫描路径的增量应用：lastSeq 短路 + 差量折叠 + 合并。 */
  private applyScanEvents(sessionId: string, events: readonly unknown[]): void {
    const entry = this.cache.sessions[sessionId]
    const lastSeq = entry?.lastSeq ?? -1
    let maxSeq = -1
    for (const e of events) {
      const seq = (e as { seq?: unknown }).seq
      if (typeof seq === 'number' && seq > maxSeq) maxSeq = seq
    }
    if (maxSeq <= lastSeq) return
    const fresh = events.filter((e) => {
      const seq = (e as { seq?: unknown }).seq
      return typeof seq === 'number' && seq > lastSeq
    })
    const delta = foldUsage(fresh as never[], localTzOffsetMinutes())
    this.cache.sessions[sessionId] = {
      lastSeq: maxSeq,
      rows: mergeRows(entry?.rows ?? [], delta),
    }
  }

  /** 持久化当前缓存（实时通道调用方触发；失败只告警不影响服务）。 */
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

  /** models.dev 导入价目（写入 settings 用户层，返回导入条数）。 */
  async importFromModelsDev(
    docText: string,
    write: (entries: ImportedPrice[]) => Promise<void>,
  ): Promise<number> {
    const doc = JSON.parse(docText) as Record<string, unknown>
    const entries = importPrices(doc as never)
    await write(entries)
    return entries.length
  }

  /** 一行费用估算（端点投影用）。 */
  rowCost(row: UsageRow): number | null {
    return estimateCost(row, this.priceTable())
  }

  dispose(): void {
    this.scanAbort?.abort()
    void this.flush()
  }
}
