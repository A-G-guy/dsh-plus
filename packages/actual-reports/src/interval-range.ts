/**
 * 区间序列：把起止日期按报表粒度展开成区间键序列——官方 `GetCardData` 里那段
 * 「先归一到粒度，再取闭区间」的等价端口。
 *
 * 注意 Weekly 是例外：先把起止日期各自归到周首，再按周展开（官方同款），
 * 这也是为什么周报表的区间键是周首日期而不是自然周序号。
 * @module @dsh-plus/actual-reports/interval-range
 */

import {
  dayFromDate,
  dayRangeInclusive,
  monthFromDate,
  rangeInclusive,
  weekFromDate,
  weekRangeInclusive,
  yearFromDate,
  yearRangeInclusive,
} from './dates.ts'

/**
 * 展开区间键序列（闭区间，含首尾）。
 *
 * @param interval - 粒度：Daily / Weekly / Monthly / Yearly。
 * @param firstDayOfWeekIdx - 周首偏好（仅 Weekly 用）。
 * @throws 未知粒度时抛出。
 */
export function intervalRangeOf(
  interval: string,
  startDate: string,
  endDate: string,
  firstDayOfWeekIdx?: string,
): string[] {
  switch (interval) {
    case 'Weekly':
      return weekRangeInclusive(
        weekFromDate(startDate, firstDayOfWeekIdx),
        weekFromDate(endDate, firstDayOfWeekIdx),
        firstDayOfWeekIdx,
      )
    case 'Daily':
      return dayRangeInclusive(startDate, endDate)
    case 'Monthly':
      return rangeInclusive(monthFromDate(startDate), monthFromDate(endDate))
    case 'Yearly':
      return yearRangeInclusive(yearFromDate(startDate), yearFromDate(endDate))
    default:
      throw new Error(
        `未知的报表粒度：${JSON.stringify(interval)}。合法取值：Daily / Weekly / Monthly / Yearly。`,
      )
  }
}

/** 粒度归一后的区间起点（诊断与展示用）。 */
export function intervalStartOf(interval: string, date: string): string {
  if (interval === 'Monthly') return monthFromDate(date)
  if (interval === 'Yearly') return yearFromDate(date)
  return dayFromDate(date)
}
