/**
 * usage 折叠器（纯函数）：从会话事件流提取 token 用量行集。
 * 权威依据 dsh-session README「Token accounting」：
 * - `assistant/chunk { chunk.type: 'usage' }` 优先；
 * - `assistant/message.usage` 是 committed-step 兜底（无 usage chunk 时）；
 * 两者只取其一，绝不双计。provider/model 取自 assistant/message 的
 * message.source（AssistantProvenance）。
 * @module usage-panel/usage-fold
 */

/** 一条聚合行：按（本地日, provider, model）归桶。 */
export interface UsageRow {
  /** 本地时区 YYYY-MM-DD（由调用方传入偏移决定，折叠器不做时区猜测）。 */
  date: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  calls: number
}

/** 折叠器输入的最窄事件面（SessionEvent 投影）。 */
export interface FoldEvent {
  type: string
  seq: number
  time: number
  data?: unknown
}

interface ChunkEventShape {
  turn?: number
  step?: number
  chunk?: { type?: string; usage?: UsageShape | null } | null
}

interface UsageShape {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

interface MessageSourceShape {
  provider?: string
  model?: string
}

interface AssistantMessageShape {
  usage?: UsageShape | null
  message?: { source?: MessageSourceShape }
}

const UNKNOWN_PROVIDER = '—'
const UNKNOWN_MODEL = '—'

const CHUNK_EVENT = 'assistant/chunk'
const MESSAGE_EVENT = 'assistant/message'

/** 步键：turn:step（同一 step 的 usage chunk 与 message 属同一次调用）。 */
function stepKey(data: { turn?: number; step?: number }): string {
  return `${data.turn ?? '?'}:${data.step ?? '?'}`
}

/** 事件时间毫秒 → 本地日字符串（按调用方时区偏移分钟）。 */
export function localDay(timeMs: number, tzOffsetMinutes: number): string {
  // tzOffsetMinutes = -getTimezoneOffset()：UTC+8 → +480。本地 = UTC + 东经偏移。
  const shifted = new Date(timeMs + tzOffsetMinutes * 60_000)
  return shifted.toISOString().slice(0, 10)
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function pick(value: unknown, fallback = 0): number {
  return isFiniteCount(value) ? value : fallback
}

/**
 * 折叠一段事件流为 usage 行集。
 * 返回行按 (date, provider, model) 排序稳定输出；同一步同时存在
 * usage chunk 与 message.usage 时以 chunk 为准（官方会计规则）。
 */
export function foldUsage(events: readonly FoldEvent[], tzOffsetMinutes: number): UsageRow[] {
  const chunkSteps = new Set<string>()
  const buckets = new Map<string, PendingRow>()
  // 第一遍：记录带 usage 的 chunk 步（优先会计源）与 provider/model 标注。
  for (const event of events) {
    if (event.type === CHUNK_EVENT) {
      const data = event.data as ChunkEventShape | undefined
      if (data?.chunk?.type === 'usage' && data.chunk.usage != null) {
        chunkSteps.add(stepKey(event.data as { turn?: number; step?: number }))
      }
    }
  }
  // 第二遍：归桶。
  for (const event of events) {
    if (event.type === CHUNK_EVENT) {
      const data = event.data as ChunkEventShape | undefined
      if (data?.chunk?.type !== 'usage' || data.chunk.usage == null) continue
      const usage = data.chunk.usage
      // chunk 不带 provider/model：先入"未标注"桶（pendingStep 记录步键），
      // 第二遍的 message 事件回填后由 finalize 合并进最终桶。
      const key = unlabeledKey(stepKey(data))
      const row = ensureRow(buckets, key, '', '')
      row.pendingStep = stepKey(data)
      annotateDate(buckets, key, localDay(event.time, tzOffsetMinutes))
      addUsage(row, usage)
      row.calls += 1
      continue
    }
    if (event.type === MESSAGE_EVENT) {
      const data = event.data as
        | (AssistantMessageShape & { turn?: number; step?: number })
        | undefined
      if (data === undefined) continue
      const key = stepKey(data)
      const usage = data.usage ?? null
      const provider = data.message?.source?.provider ?? ''
      const model = data.message?.source?.model ?? ''
      const date = localDay(event.time, tzOffsetMinutes)
      // 1) 回填同 step 的 unlabeled chunk 行：标注 + 迁移到最终桶键。
      adoptUnlabeled(buckets, key, provider, model, date)
      // 2) 无 usage chunk 的 committed step：message.usage 兜底计账。
      if (usage != null && !chunkSteps.has(key)) {
        const row = ensureRow(buckets, finalKey(date, provider, model), provider, model)
        row.date = date
        addUsage(row, usage)
        row.calls += 1
      }
    }
  }
  // 残留的 unlabeled 行（本批无 message 回填，如增量扫描只进了 chunk）：
  // 归并为每日期一行、provider/model 记为 '—'，不跨行拆散。
  const orphans = new Map<string, PendingRow>()
  for (const [key, row] of [...buckets.entries()]) {
    if (!key.startsWith('\u0000unlabeled\u0000')) continue
    buckets.delete(key)
    const okey = finalKey(row.date, UNKNOWN_PROVIDER, UNKNOWN_MODEL)
    const target = orphans.get(okey) ?? ensureRow(orphans, okey, UNKNOWN_PROVIDER, UNKNOWN_MODEL)
    target.date = row.date
    target.inputTokens += row.inputTokens
    target.outputTokens += row.outputTokens
    target.cacheReadTokens += row.cacheReadTokens
    target.cacheWriteTokens += row.cacheWriteTokens
    target.calls += row.calls
  }
  for (const [okey, orphan] of orphans) buckets.set(okey, orphan)

  return [...buckets.values()]
    .map(finalizeRow)
    .sort((a, b) =>
      a.date === b.date
        ? a.provider === b.provider
          ? a.model.localeCompare(b.model)
          : a.provider.localeCompare(b.provider)
        : a.date.localeCompare(b.date),
    )
}

/** 折叠期行（比 UsageRow 多 date/step 临时标注）。 */
interface PendingRow extends UsageRow {
  pendingStep: string
}

/** 最终桶键（与 UsageRow 身份一致）。 */
function finalKey(date: string, provider: string, model: string): string {
  return `${date}\u0000${provider}\u0000${model}`
}

/** unlabeled 桶键（chunk 先行、message 未到时的暂存）。 */
function unlabeledKey(step: string): string {
  return `\u0000unlabeled\u0000${step}`
}

/** date 单独标注（unlabeled 桶的 date 待迁移时用）。 */
function annotateDate(buckets: Map<string, PendingRow>, key: string, date: string): void {
  const row = buckets.get(key)
  if (row !== undefined) row.date = date
}

/** message 到达：把同 step 的 unlabeled 行标注并迁移到最终桶。 */
function adoptUnlabeled(
  buckets: Map<string, PendingRow>,
  step: string,
  provider: string,
  model: string,
  date: string,
): void {
  const key = unlabeledKey(step)
  const row = buckets.get(key)
  if (row === undefined) return
  buckets.delete(key)
  if (provider.length > 0) row.provider = provider
  if (model.length > 0) row.model = model
  row.date = date
  const target = ensureRow(
    buckets,
    finalKey(row.date, row.provider, row.model),
    row.provider,
    row.model,
  )
  target.date = row.date
  target.inputTokens += row.inputTokens
  target.outputTokens += row.outputTokens
  target.cacheReadTokens += row.cacheReadTokens
  target.cacheWriteTokens += row.cacheWriteTokens
  target.calls += row.calls
}

function ensureRow(
  buckets: Map<string, PendingRow>,
  key: string,
  provider: string,
  model: string,
): PendingRow {
  let row = buckets.get(key)
  if (row === undefined) {
    row = {
      date: '',
      provider,
      model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      calls: 0,
      pendingStep: '',
    }
    buckets.set(key, row)
  }
  if (provider.length > 0 && row.provider.length === 0) row.provider = provider
  if (model.length > 0 && row.model.length === 0) row.model = model
  return row
}

function addUsage(row: PendingRow, usage: UsageShape): void {
  row.inputTokens += pick(usage.inputTokens)
  row.outputTokens += pick(usage.outputTokens)
  row.cacheReadTokens += pick(usage.cacheReadTokens)
  row.cacheWriteTokens += pick(usage.cacheWriteTokens)
}

function finalizeRow(row: PendingRow): UsageRow {
  return {
    date: row.date,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    calls: row.calls,
  }
}
