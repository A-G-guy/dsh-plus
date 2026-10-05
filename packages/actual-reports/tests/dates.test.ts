/**
 * 日期工具与实时区间解析的行为测试。
 *
 * 期望值全部按官方语义手算：`yyyy-MM` 解析为该月 1 日、`This/Last month` 走
 * 「本期 offset=null」分支、周界按 firstDayOfWeekIdx 归到周首。
 * @module @dsh-plus/actual-reports/tests/dates
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  addMonthsToDay,
  currentWeekOf,
  dayRangeInclusive,
  getMonthEnd,
  monthFromDate,
  rangeInclusive,
  weekFromDate,
  weekRangeInclusive,
  yearRangeInclusive,
} from '../src/dates.ts'
import { intervalRangeOf } from '../src/interval-range.ts'
import { getLiveRange } from '../src/report-ranges.ts'

const TODAY = '2025-03-15'
const EARLIEST = '2020-01-01'
const LATEST = '2025-03-14'

/** 便捷：按今天的上下文解析实时区间。 */
function live(key: string, includeCurrentInterval = true): [string, string] {
  return getLiveRange(key, EARLIEST, LATEST, includeCurrentInterval, { today: TODAY })
}

test('月/日/年解析与格式化', () => {
  assert.equal(monthFromDate('2025-03-15'), '2025-03')
  assert.equal(getMonthEnd('2025-02-10'), '2025-02-28')
  assert.equal(getMonthEnd('2024-02-10'), '2024-02-29')
  assert.equal(addMonthsToDay('2024-01-31', 1), '2024-02-29')
})

test('周首归并与周序列（周一起算）', () => {
  assert.equal(currentWeekOf('2025-03-15', '1'), '2025-03-10')
  assert.equal(currentWeekOf('2025-03-15', '0'), '2025-03-09')
  assert.equal(weekFromDate('2025-03-10', '1'), '2025-03-10')
  assert.deepEqual(weekRangeInclusive('2025-03-10', '2025-03-20', '1'), [
    '2025-03-10',
    '2025-03-17',
  ])
})

test('月/日/年闭区间', () => {
  assert.deepEqual(rangeInclusive('2024-12-15', '2025-02-03'), ['2024-12', '2025-01', '2025-02'])
  assert.deepEqual(dayRangeInclusive('2025-03-01', '2025-03-03'), [
    '2025-03-01',
    '2025-03-02',
    '2025-03-03',
  ])
  assert.deepEqual(yearRangeInclusive('2023-05-01', '2025-01-01'), ['2023', '2024', '2025'])
})

test('区间展开按粒度归一到区间键', () => {
  assert.deepEqual(intervalRangeOf('Monthly', '2024-12-15', '2025-02-03'), [
    '2024-12',
    '2025-01',
    '2025-02',
  ])
  assert.deepEqual(intervalRangeOf('Yearly', '2023-05-01', '2025-01-01'), ['2023', '2024', '2025'])
  assert.deepEqual(intervalRangeOf('Daily', '2025-03-01', '2025-03-02'), [
    '2025-03-01',
    '2025-03-02',
  ])
  assert.deepEqual(intervalRangeOf('Weekly', '2025-03-10', '2025-03-20', '1'), [
    '2025-03-10',
    '2025-03-17',
  ])
})

test('数字型实时区间：本期、上一期与最近 N 期', () => {
  assert.deepEqual(live('This month'), ['2025-03-01', '2025-03-31'])
  assert.deepEqual(live('Last month'), ['2025-02-01', '2025-03-31'])
  assert.deepEqual(live('Last 6 months'), ['2024-09-01', '2025-03-31'])
  assert.deepEqual(live('Last 3 months', false), ['2024-12-01', '2025-02-28'])
  assert.deepEqual(live('Last 30 days'), ['2025-02-14', '2025-03-15'])
})

test('特殊实时区间：年、季度与全部', () => {
  assert.deepEqual(live('Year to date'), ['2025-01-01', '2025-03-15'])
  assert.deepEqual(live('Last year'), ['2024-01-01', '2024-12-31'])
  assert.deepEqual(live('Prior year to date'), ['2024-01-01', '2024-03-15'])
  assert.deepEqual(live('Current quarter'), ['2025-01-01', '2025-03-31'])
  assert.deepEqual(live('Previous quarter'), ['2024-10-01', '2024-12-31'])
  assert.deepEqual(live('All time'), [EARLIEST, LATEST])
})

test('周区间按周首解析', () => {
  assert.deepEqual(
    getLiveRange('This week', EARLIEST, LATEST, true, { today: TODAY, firstDayOfWeekIdx: '1' }),
    ['2025-03-10', '2025-03-16'],
  )
})

test('起点早于最早交易时收敛到最早交易', () => {
  assert.deepEqual(getLiveRange('Last 12 months', '2024-06-01', LATEST, true, { today: TODAY }), [
    '2024-06-01',
    '2025-03-31',
  ])
})

test('未知实时区间显式报错', () => {
  assert.throws(() => live('Yesterday'), /未知的实时区间/)
})

test('未知粒度显式报错', () => {
  assert.throws(() => intervalRangeOf('Hourly', '2025-01-01', '2025-01-02'), /未知的报表粒度/)
})
