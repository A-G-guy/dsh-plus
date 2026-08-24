/**
 * 缓存：lastSeq 短路、损坏降级、mergeRows 同键累加。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeRows, parseCache } from '../src/cache.ts'
import type { UsageRow } from '../src/usage-fold.ts'

function row(over: Partial<UsageRow>): UsageRow {
  return {
    date: '2026-08-25',
    provider: 'a',
    model: 'm',
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 1,
    ...over,
  }
}

test('parseCache：合法文档往返保留会话条目', () => {
  const cache = parseCache(
    JSON.stringify({
      version: 1,
      sessions: {
        s1: { lastSeq: 42, rows: [row({ inputTokens: 10 })] },
      },
    }),
  )
  assert.notEqual(cache, null)
  assert.equal(cache?.sessions.s1?.lastSeq, 42)
  assert.equal(cache?.sessions.s1?.rows[0]?.inputTokens, 10)
})

test('parseCache：损坏 JSON / 版本不符 / 形状非法 → null（降级全量重建）', () => {
  assert.equal(parseCache('{broken'), null)
  assert.equal(parseCache(JSON.stringify({ version: 99, sessions: {} })), null)
  assert.equal(parseCache(JSON.stringify({ version: 1, sessions: [] })), null)
})

test('parseCache：行字段非法的条目被剔除，其余保留', () => {
  const cache = parseCache(
    JSON.stringify({
      version: 1,
      sessions: {
        s1: {
          lastSeq: 1,
          rows: [row({}), { date: 123, provider: 'x', model: 'y' }],
        },
      },
    }),
  )
  assert.equal(cache?.sessions.s1?.rows.length, 1)
})

test('mergeRows：同键桶累加、异键并存、输出有序', () => {
  const merged = mergeRows(
    [row({ inputTokens: 10, calls: 2 })],
    [row({ inputTokens: 5, calls: 1 }), row({ date: '2026-08-24', provider: 'b' })],
  )
  assert.equal(merged.length, 2)
  assert.equal(merged[0]?.date, '2026-08-24')
  const am = merged.find((r) => r.provider === 'a')
  assert.equal(am?.inputTokens, 15)
  assert.equal(am?.calls, 3)
})
