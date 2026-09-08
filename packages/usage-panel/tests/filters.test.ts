/**
 * 筛选与自动同步规划：filterRows 日期/模型维度、planSync 三种动作判定。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMPTY_CACHE, type UsageCache } from '../src/cache.ts'
import { filterRows, normalizeCustomRange, resolveRange } from '../src/ranges.ts'
import { planSync, type SnapshotLike } from '../src/sync-runner.ts'
import type { UsageRow } from '../src/usage-fold.ts'

const TODAY = '2026-08-25'

function row(over: Partial<UsageRow>): UsageRow {
  return {
    date: TODAY,
    provider: 'a',
    model: 'm',
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 1,
    ...over,
  }
}

function cacheOf(sessions: UsageCache['sessions']): UsageCache {
  return { ...EMPTY_CACHE, sessions }
}

test('filterRows：日期范围含端点、provider/model 精确匹配', () => {
  const rows = [
    row({ date: '2026-08-24', provider: 'a', model: 'm' }),
    row({ date: '2026-08-25', provider: 'b', model: 'm' }),
    row({ date: '2026-08-25', provider: 'a', model: 'x' }),
  ]
  const filtered = filterRows(rows, { range: { start: '2026-08-25', end: '2026-08-25' } })
  assert.equal(filtered.length, 2)
  const byProvider = filterRows(rows, { range: null, provider: 'a' })
  assert.equal(byProvider.length, 2)
  const byModel = filterRows(rows, { range: null, provider: 'a', model: 'x' })
  assert.equal(byModel.length, 1)
  assert.equal(byModel[0]?.model, 'x')
})

test('filterRows：空白 provider/model 视为不过滤', () => {
  const rows = [row({ provider: 'a', model: 'm' })]
  assert.equal(filterRows(rows, { range: null, provider: '  ', model: '' }).length, 1)
})

test('resolveRange：custom 走显式区间；非法输入回落 null', () => {
  assert.deepEqual(resolveRange('custom', TODAY, { start: '2026-08-01', end: '2026-08-20' }), {
    start: '2026-08-01',
    end: '2026-08-20',
  })
  assert.equal(resolveRange('custom', TODAY, { start: 'bad', end: '' }), null)
  assert.equal(resolveRange('custom', TODAY), null)
  assert.deepEqual(resolveRange('7d', TODAY), { start: '2026-08-19', end: TODAY })
})

test('normalizeCustomRange：起止倒置自动交换', () => {
  assert.deepEqual(normalizeCustomRange('2026-08-20', '2026-08-01'), {
    start: '2026-08-01',
    end: '2026-08-20',
  })
  assert.equal(normalizeCustomRange('', ''), null)
})

test('planSync：revision 一致 → skip；无 revision 但有 lastSeq → tail；新会话 → full', () => {
  const cache = cacheOf({
    kept: { revision: 'r1', lastSeq: 10, rows: [row({})] },
    tail: { lastSeq: 5, rows: [] },
  })
  const snapshots: SnapshotLike[] = [
    { header: { id: 'kept' }, revision: 'r1' },
    { header: { id: 'tail' }, revision: 'r2' },
    { header: { id: 'fresh' }, revision: 'r9' },
  ]
  const plan = planSync(snapshots, cache)
  assert.deepEqual(plan, [
    { id: 'kept', action: 'skip' },
    { id: 'tail', action: 'tail', fromSeq: 6 },
    { id: 'fresh', action: 'full' },
  ])
})

test('planSync：后端未提供 revision 时回退 lastSeq 增量（不误判 skip）', () => {
  const cache = cacheOf({ s1: { lastSeq: 7, rows: [] } })
  const plan = planSync([{ header: { id: 's1' } }], cache)
  assert.deepEqual(plan, [{ id: 's1', action: 'tail', fromSeq: 8 }])
})
