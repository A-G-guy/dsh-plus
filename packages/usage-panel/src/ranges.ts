/**
 * 范围切片（纯函数）：行集 → 时间范围聚合视图（概要/按日/按模型）。
 * 支持快捷区间与自定义日期区间、provider/model 维度筛选。
 * @module usage-panel/ranges
 */
import type { UsageRow } from './usage-fold.ts'

export type RangeKey = '7d' | '30d' | 'month' | 'all' | 'custom'

/** 当天本地日（供默认范围计算；测试注入固定值）。 */
export function today(nowMs: number, tzOffsetMinutes: number): string {
  return new Date(nowMs - tzOffsetMinutes * 60_000).toISOString().slice(0, 10)
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

/** 范围键 → [start, end]（含端点；end = 今天）。 */
export function rangeDays(key: RangeKey, todayStr: string): { start: string; end: string } | null {
  switch (key) {
    case '7d':
      return { start: addDays(todayStr, -6), end: todayStr }
    case '30d':
      return { start: addDays(todayStr, -29), end: todayStr }
    case 'month':
      return { start: `${todayStr.slice(0, 7)}-01`, end: todayStr }
    case 'all':
    case 'custom':
      return null
  }
}

/** 快捷范围键解析为具体区间（custom 走显式 start/end）。 */
export function resolveRange(
  key: RangeKey,
  todayStr: string,
  custom?: { start?: string; end?: string },
): { start: string; end: string } | null {
  if (key === 'custom') {
    if (custom === undefined) return null
    const start = isDay(custom.start) ? custom.start : undefined
    const end = isDay(custom.end) ? custom.end : undefined
    if (start === undefined && end === undefined) return null
    return { start: start ?? '0000-01-01', end: end ?? '9999-12-31' }
  }
  return rangeDays(key, todayStr)
}

function isDay(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** 归一化自定义区间（start > end 时交换；非法输入 → null）。 */
export function normalizeCustomRange(
  start: string | undefined,
  end: string | undefined,
): { start: string; end: string } | null {
  if (!isDay(start) && !isDay(end)) return null
  const s = isDay(start) ? start : '0000-01-01'
  const e = isDay(end) ? end : '9999-12-31'
  return s <= e ? { start: s, end: e } : { start: e, end: s }
}

export interface FilterSpec {
  range: { start: string; end: string } | null
  /** provider 精确匹配（空/缺省 = 不过滤）。 */
  provider?: string
  /** model 精确匹配（空/缺省 = 不过滤）。 */
  model?: string
}

/** 无关字段为空时不做该维度过滤（trim 后空串视为未指定）。泛型保形：wire 行（含 cost）过滤后仍是 wire 行。 */
export function filterRows<T extends UsageRow>(rows: readonly T[], spec: FilterSpec): T[] {
  const provider = spec.provider?.trim() ?? ''
  const model = spec.model?.trim() ?? ''
  return rows.filter((row) => {
    if (spec.range !== null) {
      if (row.date < spec.range.start || row.date > spec.range.end) return false
    }
    if (provider.length > 0 && row.provider !== provider) return false
    if (model.length > 0 && row.model !== model) return false
    return true
  })
}

export interface DayTotal {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  calls: number
}

export interface ModelTotal {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  calls: number
}

function emptyTotals(): Omit<DayTotal & ModelTotal, 'date' | 'provider' | 'model'> {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 0,
  }
}

function accumulate(rows: readonly UsageRow[]): Map<string, DayTotal> {
  const buckets = new Map<string, DayTotal>()
  for (const row of rows) {
    let bucket = buckets.get(row.date)
    if (bucket === undefined) {
      bucket = { date: row.date, ...emptyTotals() }
      buckets.set(bucket.date, bucket)
    }
    bucket.inputTokens += row.inputTokens
    bucket.outputTokens += row.outputTokens
    bucket.cacheReadTokens += row.cacheReadTokens
    bucket.cacheWriteTokens += row.cacheWriteTokens
    bucket.calls += row.calls
  }
  return buckets
}

/** 按日聚合：固定区间（非 all）每天一行零补齐；all 只含有用量的日子。 */
export function totalsByDay(
  rows: readonly UsageRow[],
  key: RangeKey,
  todayStr: string,
  custom?: { start?: string; end?: string },
): DayTotal[] {
  const buckets = accumulate(rows)
  const range = resolveRange(key, todayStr, custom)
  if (range === null) {
    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
  }
  const out: DayTotal[] = []
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const bucket = buckets.get(day)
    out.push(bucket ?? { date: day, ...emptyTotals() })
  }
  return out
}

/** 按模型聚合（calls 降序，同 calls 按 provider/model 字典序）。 */
export function totalsByModel(rows: readonly UsageRow[]): ModelTotal[] {
  const buckets = new Map<string, ModelTotal>()
  for (const row of rows) {
    const key = `${row.provider}\u0000${row.model}`
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = { provider: row.provider, model: row.model, ...emptyTotals() }
      buckets.set(key, bucket)
    }
    bucket.inputTokens += row.inputTokens
    bucket.outputTokens += row.outputTokens
    bucket.cacheReadTokens += row.cacheReadTokens
    bucket.cacheWriteTokens += row.cacheWriteTokens
    bucket.calls += row.calls
  }
  return [...buckets.values()].sort(
    (a, b) =>
      b.calls - a.calls || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
  )
}
