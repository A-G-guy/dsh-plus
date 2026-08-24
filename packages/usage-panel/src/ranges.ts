/**
 * 范围切片（纯函数）：行集 → 时间范围聚合视图（概要/按日/按模型）。
 * @module usage-panel/ranges
 */
import type { UsageRow } from './usage-fold.ts'

export type RangeKey = '7d' | '30d' | 'month' | 'all'

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
      return null
  }
}

/** 过滤范围内的行（all = 全量）。 */
export function rowsInRange(
  rows: readonly UsageRow[],
  key: RangeKey,
  todayStr: string,
): UsageRow[] {
  const range = rangeDays(key, todayStr)
  if (range === null) return [...rows]
  return rows.filter((row) => row.date >= range.start && row.date <= range.end)
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

/** 按日聚合（升序，范围每天一行，零用量日补零）。 */
export function totalsByDay(
  rows: readonly UsageRow[],
  key: RangeKey,
  todayStr: string,
): DayTotal[] {
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
  const range = rangeDays(key, todayStr)
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
