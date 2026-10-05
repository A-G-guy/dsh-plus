/**
 * 区间解析：把报表的「实时区间」键（This month / Last 6 months / Year to date …）
 * 解析成具体起止日期——官方 `reportRanges.ts` + `getLiveRange.ts` 的等价端口。
 *
 * 三处必须逐字对齐的细节：
 * - `This month` / `This week` 传 `addNumber = null`（即「就从本期开头算」），
 *   其余数字区间按 `includeCurrentInterval` 决定是否把当前周期算进去；
 * - 起点早于最早交易时收敛到最早交易（`validateRange`）；
 * - 未知区间键不回落到别的区间，而是抛错。
 * @module @dsh-plus/actual-reports/report-ranges
 */

import {
  addMonths,
  addMonthsToDay,
  addWeeks,
  currentWeekOf,
  getMonthEnd,
  getQuarterEnd,
  getQuarterStart,
  getWeekEnd,
  lastDayOfMonth,
  prevQuarter,
  prevYear,
  subDays,
  subMonths,
  subWeeks,
} from './dates.ts'
import { DATE_RANGE_SPEC } from './model.ts'

/** 解析所需的时间上下文（时钟与周首偏好显式传入）。 */
export interface RangeContext {
  /** 今天（`yyyy-MM-dd`）。 */
  today: string
  firstDayOfWeekIdx?: string
}

/** 起点早于最早交易时收敛（官方 `validateRange`）。 */
export function validateRange(earliest: string, start: string, end: string): [string, string] {
  return [start < earliest ? earliest : start, end]
}

/**
 * 数字型区间：往前 offset 个周期，再按 addNumber 展宽（官方 `getSpecificRange`）。
 *
 * @param offset - 往前多少个周期。
 * @param addNumber - 展开的周期数；null = 只用 offset（本期区间用法）。
 */
export function getSpecificRange(
  offset: number,
  addNumber: number | null,
  type: string | undefined,
  ctx: RangeContext,
): [string, string] {
  const currentWeek = currentWeekOf(ctx.today, ctx.firstDayOfWeekIdx)
  let dateStart = `${subMonths(ctx.today, offset)}-01`
  let dateEnd = getMonthEnd(`${addMonths(dateStart, addNumber === null ? offset : addNumber)}-01`)
  if (type === 'Week') {
    dateStart = subWeeks(currentWeek, offset)
    dateEnd = getWeekEnd(
      addWeeks(dateStart, addNumber === null ? offset : addNumber),
      ctx.firstDayOfWeekIdx,
    )
  }
  return [dateStart, dateEnd]
}

/** 特殊区间（字符串 name）的解析分支，命中返回起止，否则 undefined。 */
function specialRange(
  name: string,
  earliest: string,
  latest: string,
  ctx: RangeContext,
): [string, string] | undefined {
  const { today } = ctx
  const currentMonth = today.slice(0, 7)
  switch (name) {
    case 'yearToDate':
      return validateRange(earliest, `${currentMonth.slice(0, 4)}-01-01`, today)
    case 'lastMonth': {
      const prev = subMonths(currentMonth, 1)
      return validateRange(earliest, `${prev}-01`, lastDayOfMonth(prev))
    }
    case 'lastYear': {
      const year = prevYear(currentMonth)
      return validateRange(earliest, `${year}-01-01`, `${year}-12-31`)
    }
    case 'priorYearToDate': {
      const year = prevYear(currentMonth)
      return validateRange(earliest, `${year}-01-01`, addMonthsToDay(today, -12))
    }
    case 'currentQuarter':
      return validateRange(
        earliest,
        `${getQuarterStart(currentMonth)}-01`,
        lastDayOfMonth(getQuarterEnd(currentMonth)),
      )
    case 'previousQuarter': {
      const prev = prevQuarter(currentMonth)
      return validateRange(
        earliest,
        `${getQuarterStart(prev)}-01`,
        lastDayOfMonth(getQuarterEnd(prev)),
      )
    }
    case 'last30Days':
      return validateRange(earliest, subDays(today, 29), today)
    case 'allTime':
      return [earliest, latest]
    default:
      return undefined
  }
}

/**
 * 解析实时区间。
 *
 * @param key - 报表的 `dateRange` 界面键。
 * @param earliest - 最早交易日期（`yyyy-MM-dd`）。
 * @param latest - 最晚交易日期（`yyyy-MM-dd`）。
 * @param includeCurrentInterval - 是否把当前周期算进区间。
 * @throws 未知区间键（不在官方 `dateRangeOptions` 内）时抛出。
 */
export function getLiveRange(
  key: string,
  earliest: string,
  latest: string,
  includeCurrentInterval: boolean,
  ctx: RangeContext,
): [string, string] {
  const spec = DATE_RANGE_SPEC[key]
  if (spec === undefined) {
    throw new Error(
      `未知的实时区间：${JSON.stringify(key)}。合法取值：${Object.keys(DATE_RANGE_SPEC).join(' / ')}`,
    )
  }
  const special =
    typeof spec.name === 'string' ? specialRange(spec.name, earliest, latest, ctx) : undefined
  if (special !== undefined) return special
  if (typeof spec.name !== 'number') {
    throw new Error(`实时区间 ${key} 的解析未实现（name=${String(spec.name)}）`)
  }
  const isCurrentPeriod = key === 'This month' || key === 'This week'
  return validateRange(
    earliest,
    ...getSpecificRange(
      spec.name,
      isCurrentPeriod ? null : spec.name - (includeCurrentInterval ? 0 : 1),
      spec.type,
      ctx,
    ),
  )
}
