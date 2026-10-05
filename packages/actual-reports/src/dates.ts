/**
 * 日期工具：官方 `@actual-app/core/shared/months` 中本工具用到的那部分语义的
 * 等价实现（纯 Date 运算，不引第三方依赖）。
 *
 * 与官方一致的两条约定：
 * - `yyyy-MM` 解析为该月 1 日，`yyyy` 解析为该年 1 月 1 日（本地时区，与官方
 *   date-fns 行为一致）；
 * - 周相关运算以 `firstDayOfWeekIdx`（'0' = 周日起）为周首。
 *
 * `today` 一律由调用方显式传入（不在库内读时钟），单测因此完全确定。
 * @module @dsh-plus/actual-reports/dates
 */

/** 允许的日期输入形态。 */
export type DateLike = string | Date

/** 日期格式化：只支持本工具用到的三种模式。 */
export type DatePattern = 'yyyy-MM-dd' | 'yyyy-MM' | 'yyyy'

/** 两位补零。 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 解析日期字符串。
 * @throws 形态无法识别时抛出（不猜、不回落）。
 */
export function parseDate(value: DateLike): Date {
  if (value instanceof Date) return new Date(value.getTime())
  const text = value.trim()
  if (/^\d{4}$/.test(text)) return new Date(Number(text), 0, 1)
  if (/^\d{4}-\d{2}$/.test(text)) {
    const [year, month] = text.split('-')
    return new Date(Number(year), Number(month) - 1, 1)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-')
    return new Date(Number(year), Number(month) - 1, Number(day))
  }
  throw new Error(`无法解析日期：${JSON.stringify(value)}（支持 yyyy / yyyy-MM / yyyy-MM-dd）`)
}

/** 按模式格式化。 */
export function formatDate(date: Date, pattern: DatePattern): string {
  const year = String(date.getFullYear())
  if (pattern === 'yyyy') return year
  const month = pad2(date.getMonth() + 1)
  if (pattern === 'yyyy-MM') return `${year}-${month}`
  return `${year}-${month}-${pad2(date.getDate())}`
}

/** `yyyy-MM-dd`。 */
export function dayFromDate(value: DateLike): string {
  return formatDate(parseDate(value), 'yyyy-MM-dd')
}

/** `yyyy-MM`。 */
export function monthFromDate(value: DateLike): string {
  return formatDate(parseDate(value), 'yyyy-MM')
}

/** `yyyy`。 */
export function yearFromDate(value: DateLike): string {
  return formatDate(parseDate(value), 'yyyy')
}

/** 周首索引归一（'0'/undefined = 周日，与官方 `parseInt(idx || '0')` 一致）。 */
export function weekStartsOn(firstDayOfWeekIdx?: string): number {
  const value = Number.parseInt(firstDayOfWeekIdx ?? '0', 10)
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 0
}

/** 周首当天（date-fns `startOfWeek` 语义）。 */
export function startOfWeek(date: Date, weekStart: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const delta = (result.getDay() - weekStart + 7) % 7
  result.setDate(result.getDate() - delta)
  return result
}

/** 周末当天（date-fns `endOfWeek` 语义）。 */
export function endOfWeek(date: Date, weekStart: number): Date {
  const start = startOfWeek(date, weekStart)
  start.setDate(start.getDate() + 6)
  return start
}

/** 该日期所属周的周首 `yyyy-MM-dd`。 */
export function weekFromDate(value: DateLike, firstDayOfWeekIdx?: string): string {
  return dayFromDate(startOfWeek(parseDate(value), weekStartsOn(firstDayOfWeekIdx)))
}

/** 今天所在周的周首（官方 `currentWeek`）。 */
export function currentWeekOf(today: string, firstDayOfWeekIdx?: string): string {
  return weekFromDate(today, firstDayOfWeekIdx)
}

/** 加天数。 */
export function addDays(value: DateLike, n: number): string {
  const date = parseDate(value)
  date.setDate(date.getDate() + n)
  return dayFromDate(date)
}

/** 减天数。 */
export function subDays(value: DateLike, n: number): string {
  return addDays(value, -n)
}

/** 加周数。 */
export function addWeeks(value: DateLike, n: number): string {
  return addDays(value, n * 7)
}

/** 减周数。 */
export function subWeeks(value: DateLike, n: number): string {
  return addDays(value, -n * 7)
}

/** 加月数（date-fns 语义：目标月天数不足时收敛到月末）。 */
export function addMonths(value: DateLike, n: number): string {
  const date = parseDate(value)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + n)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return formatDate(date, 'yyyy-MM')
}

/** 减月数。 */
export function subMonths(value: DateLike, n: number): string {
  return addMonths(value, -n)
}

/** 按天粒度加月数（保留日），返回 `yyyy-MM-dd`。 */
export function addMonthsToDay(value: DateLike, n: number): string {
  const date = parseDate(value)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + n)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return dayFromDate(date)
}

/** 上一年同月（`yyyy`）。 */
export function prevYear(value: DateLike): string {
  return formatDate(new Date(parseDate(value).getFullYear() - 1, 0, 1), 'yyyy')
}

/** 上一季度同月（`yyyy-MM`）。 */
export function prevQuarter(value: DateLike): string {
  return subMonths(value, 3)
}

/** 该月最后一天。 */
export function getMonthEnd(value: DateLike): string {
  const date = parseDate(value)
  return dayFromDate(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

/** 该月第一天。 */
export function firstDayOfMonth(value: DateLike): string {
  return `${monthFromDate(value)}-01`
}

/** 该月最后一天。 */
export function lastDayOfMonth(value: DateLike): string {
  return getMonthEnd(value)
}

/** 该周最后一天。 */
export function getWeekEnd(value: DateLike, firstDayOfWeekIdx?: string): string {
  return dayFromDate(endOfWeek(parseDate(value), weekStartsOn(firstDayOfWeekIdx)))
}

/** 年份首月（`yyyy-01`）。 */
export function getYearStart(value: DateLike): string {
  return `${yearFromDate(value)}-01`
}

/** 年份末月（`yyyy-12`）。 */
export function getYearEnd(value: DateLike): string {
  return `${yearFromDate(value)}-12`
}

/** 季度序号（1-4）。 */
export function getQuarter(value: DateLike): number {
  return Math.floor(parseDate(value).getMonth() / 3) + 1
}

/** 季度首月（`yyyy-MM`）。 */
export function getQuarterStart(value: DateLike): string {
  const date = parseDate(value)
  return `${date.getFullYear()}-${pad2((getQuarter(value) - 1) * 3 + 1)}`
}

/** 季度末月（`yyyy-MM`）。 */
export function getQuarterEnd(value: DateLike): string {
  const date = parseDate(value)
  return `${date.getFullYear()}-${pad2(getQuarter(value) * 3)}`
}

/** 严格早于。 */
export function isBefore(left: DateLike, right: DateLike): boolean {
  return parseDate(left).getTime() < parseDate(right).getTime()
}

/** 严格晚于。 */
export function isAfter(left: DateLike, right: DateLike): boolean {
  return parseDate(left).getTime() > parseDate(right).getTime()
}

/** 月序列（含首尾），如 `['2024-01','2024-02']`。 */
export function rangeInclusive(start: DateLike, end: DateLike): string[] {
  const months: string[] = []
  let month = monthFromDate(start)
  const endMonth = monthFromDate(end)
  let guard = 0
  while (isBefore(month, endMonth)) {
    months.push(month)
    month = addMonths(month, 1)
    guard += 1
    if (guard > 10_000) throw new Error('月份区间过大：请检查报表的起止日期')
  }
  months.push(endMonth)
  return months
}

/** 日序列（含首尾）。 */
export function dayRangeInclusive(start: DateLike, end: DateLike): string[] {
  const days: string[] = []
  let day = dayFromDate(start)
  const endDay = dayFromDate(end)
  let guard = 0
  while (isBefore(day, endDay)) {
    days.push(day)
    day = addDays(day, 1)
    guard += 1
    if (guard > 100_000) throw new Error('日期区间过大：请检查报表的起止日期')
  }
  days.push(endDay)
  return days
}

/** 周序列（含首尾），键为周首 `yyyy-MM-dd`。 */
export function weekRangeInclusive(
  start: DateLike,
  end: DateLike,
  firstDayOfWeekIdx?: string,
): string[] {
  const weeks: string[] = []
  let week = weekFromDate(start, firstDayOfWeekIdx)
  const endWeek = weekFromDate(end, firstDayOfWeekIdx)
  let guard = 0
  while (isBefore(week, endWeek)) {
    weeks.push(week)
    week = addWeeks(week, 1)
    guard += 1
    if (guard > 10_000) throw new Error('周区间过大：请检查报表的起止日期')
  }
  weeks.push(endWeek)
  return weeks
}

/** 年序列（含首尾）。 */
export function yearRangeInclusive(start: DateLike, end: DateLike): string[] {
  const years: string[] = []
  let year = yearFromDate(start)
  const endYear = yearFromDate(end)
  let guard = 0
  while (isBefore(year, endYear)) {
    years.push(year)
    year = formatDate(new Date(Number(year) + 1, 0, 1), 'yyyy')
    guard += 1
    if (guard > 1_000) throw new Error('年份区间过大：请检查报表的起止日期')
  }
  years.push(endYear)
  return years
}
