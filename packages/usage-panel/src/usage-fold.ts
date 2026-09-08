/**
 * usage 折叠器（纯函数）：从会话事件流提取 token 用量行集。
 * 口径对齐 0.1.3 官方 token-meter（usage-projection fold）：
 * - 会计源是 assistant 结算事件（assistant/message / assistant/attempt），
 *   usage 取 `message.usage`，缺席时回落 stream 记录内嵌的 usage chunk；
 * - 单一 `last` 替换槽：同一 (turn, step) 连续重结算按替换计入；
 * - `llm/retry-started` 关闭替换槽（对齐官方 last 重置，重试后重新累加）。
 * provider/model 取自 assistant/message 的 message.source（AssistantProvenance）。
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

/** assistant 结算事件携带的耗损紧凑流记录（`chunk` 变体可能内嵌 usage）。 */
interface StreamRecordShape {
  type?: string
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

interface SettlementShape {
  turn?: number
  step?: number
  usage?: UsageShape | null
  message?: { source?: MessageSourceShape }
  stream?: readonly StreamRecordShape[]
}

const UNKNOWN = '—'
const RETRY_EVENT = 'llm/retry-started'
const MESSAGE_EVENT = 'assistant/message'
const ATTEMPT_EVENT = 'assistant/attempt'

/** 折叠期行（UsageRow + 结算键，用于重试替换语义）。 */
interface PendingRow extends UsageRow {
  lastKey: string
}

/** 替换槽：最近一次结算的步键、桶键与样本（对齐官方 last）。 */
interface LastSlot {
  step: string
  bucketKey: string
  usage: UsageShape
}

function stepKey(data: SettlementShape): string {
  return `${data.turn ?? '?'}:${data.step ?? '?'}`
}

/**
 * 结算事件的使用量样本：`usage` 字段优先（官方 `usageOf` 同序），缺席回落
 * stream 内嵌的最后一个 usage chunk。
 */
function settlementUsage(data: SettlementShape): UsageShape | null {
  if (data.usage != null) return data.usage
  const stream = data.stream
  if (!Array.isArray(stream)) return null
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const record = stream[i]
    if (
      typeof record === 'object' &&
      record !== null &&
      record.type === 'chunk' &&
      record.chunk?.type === 'usage' &&
      record.chunk.usage != null
    ) {
      return record.chunk.usage
    }
  }
  return null
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

function addUsage(row: PendingRow, usage: UsageShape): void {
  row.inputTokens += pick(usage.inputTokens)
  row.outputTokens += pick(usage.outputTokens)
  row.cacheReadTokens += pick(usage.cacheReadTokens)
  row.cacheWriteTokens += pick(usage.cacheWriteTokens)
}

function subUsage(row: PendingRow, usage: UsageShape): void {
  row.inputTokens -= pick(usage.inputTokens)
  row.outputTokens -= pick(usage.outputTokens)
  row.cacheReadTokens -= pick(usage.cacheReadTokens)
  row.cacheWriteTokens -= pick(usage.cacheWriteTokens)
}

/**
 * 折叠一段事件流为 usage 行集。
 * 返回行按 (date, provider, model) 排序稳定输出；同一 (turn, step) 的
 * 连续重结算按替换计入（先回撤旧样本再加新样本，对齐官方 addReplacing），
 * `llm/retry-started` 关闭替换槽使重试的新尝试照常累加（失败尝试计入）。
 */
export function foldUsage(events: readonly FoldEvent[], tzOffsetMinutes: number): UsageRow[] {
  const buckets = new Map<string, PendingRow>()
  let last: LastSlot | null = null
  for (const event of events) {
    if (event.type === RETRY_EVENT) {
      const data = (event.data ?? {}) as SettlementShape
      if (last !== null && last.step === stepKey(data)) last = null
      continue
    }
    if (event.type !== MESSAGE_EVENT && event.type !== ATTEMPT_EVENT) continue
    const data = (event.data ?? {}) as SettlementShape
    const usage = settlementUsage(data)
    if (usage === null) continue
    const step = stepKey(data)
    const replacing = last !== null && last.step === step
    // 替换结算：先回撤旧样本（旧桶可能因回撤清空而被删除）。
    if (replacing && last !== null) {
      const previous = last
      const old = buckets.get(previous.bucketKey)
      if (old !== undefined) {
        subUsage(old, previous.usage)
        old.calls -= 1
        if (old.calls <= 0) buckets.delete(previous.bucketKey)
      }
    }
    const date = localDay(event.time, tzOffsetMinutes)
    const message = event.type === MESSAGE_EVENT ? data.message : undefined
    const provider = message?.source?.provider ?? ''
    const model = message?.source?.model ?? ''
    const labeled = provider.length > 0 || model.length > 0
    const bucketKey = labeled
      ? `${date}\u0000${provider}\u0000${model}`
      : `\0unlabeled\u0000${date}`
    let row = buckets.get(bucketKey)
    if (row === undefined) {
      row = {
        date,
        provider,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        calls: 0,
        lastKey: '',
      }
      buckets.set(bucketKey, row)
    }
    if (provider.length > 0) row.provider = provider
    if (model.length > 0) row.model = model
    addUsage(row, usage)
    row.calls += 1
    row.lastKey = step
    last = { step, bucketKey, usage }
  }
  return [...buckets.values()]
    .map((row) => {
      const { lastKey: _lastKey, ...rest } = row
      // 仅有 attempt（无 message 回填 provider）的失败尝试：归入「—」聚合行。
      if (rest.provider.length === 0 && rest.model.length === 0) {
        return { ...rest, provider: UNKNOWN, model: UNKNOWN }
      }
      return rest
    })
    .sort((a, b) =>
      a.date === b.date
        ? a.provider === b.provider
          ? a.model.localeCompare(b.model)
          : a.provider.localeCompare(b.provider)
        : a.date.localeCompare(b.date),
    )
}
