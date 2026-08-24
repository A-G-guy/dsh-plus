/**
 * 范围切片：7d/30d/month/all 边界、按日补零、按模型排序。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rangeDays, rowsInRange, totalsByDay, totalsByModel } from '../src/ranges.ts'
import type { UsageRow } from '../src/usage-fold.ts'

const TODAY = '2026-08-25'

function row(date: string, provider = 'a', model = 'm', calls = 1): UsageRow {
  return {
    date,
    provider,
    model,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls,
  }
}

test('7d 范围含端点 7 天；30d 含 30 天；month 从 1 号起', () => {
  assert.deepEqual(rangeDays('7d', TODAY), { start: '2026-08-19', end: TODAY })
  assert.deepEqual(rangeDays('30d', TODAY), { start: '2026-07-27', end: TODAY })
  assert.deepEqual(rangeDays('month', TODAY), { start: '2026-08-01', end: TODAY })
  assert.equal(rangeDays('all', TODAY), null)
})

test('rowsInRange：范围外过滤、all 全量', () => {
  const rows = [row('2026-08-01'), row('2026-08-24'), row('2026-08-25'), row('2026-09-01')]
  assert.equal(rowsInRange(rows, '7d', TODAY).length, 2)
  assert.equal(rowsInRange(rows, 'month', TODAY).length, 3)
  assert.equal(rowsInRange(rows, 'all', TODAY).length, 4)
})

test('totalsByDay：范围内每天一行，零用量日补零', () => {
  const days = totalsByDay([row('2026-08-25')], '7d', TODAY)
  assert.equal(days.length, 7)
  assert.equal(days[0]?.date, '2026-08-19')
  assert.equal(days[0]?.inputTokens, 0)
  assert.equal(days[6]?.inputTokens, 10)
})

test('totalsByModel：calls 降序，同 calls 按字典序', () => {
  const rows = [
    row(TODAY, 'a', 'x', 1),
    row(TODAY, 'a', 'x', 2),
    row(TODAY, 'b', 'z', 9),
    row(TODAY, 'b', 'a', 9),
  ]
  const models = totalsByModel(rows)
  assert.deepEqual(
    models.map((m) => `${m.provider}/${m.model}`),
    ['b/a', 'b/z', 'a/x'],
  )
  assert.equal(models[2]?.calls, 3)
})
