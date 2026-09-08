/**
 * usage 折叠器：settlement 优先级（usage 字段 / stream 内嵌 chunk）、
 * 重试替换语义、provider/model 归桶、跨日切分。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type FoldEvent, foldUsage, localDay } from '../src/usage-fold.ts'

const TZ = 480 // UTC+8（本机服务器时区）
const T0 = Date.UTC(2026, 7, 25, 2, 0)

function messageEvent(
  turn: number,
  step: number,
  provider: string,
  model: string,
  usage: object | null,
  time = T0,
): FoldEvent {
  return {
    type: 'assistant/message',
    seq: 2,
    time,
    data: {
      turn,
      step,
      ...(usage === null ? {} : { usage }),
      message: { source: { kind: 'model', provider, model } },
    },
  }
}

/** stream 内嵌 usage chunk（0.1.3：usage 随 stream 落盘在 message/attempt 内）。 */
function messageWithStreamUsage(
  turn: number,
  step: number,
  provider: string,
  model: string,
  usage: object,
): FoldEvent {
  return {
    type: 'assistant/message',
    seq: 3,
    time: T0,
    data: {
      turn,
      step,
      message: { source: { kind: 'model', provider, model } },
      stream: [{ type: 'chunk', time: T0, chunk: { type: 'usage', usage } }],
    },
  }
}

function attemptEvent(turn: number, step: number, usage: object): FoldEvent {
  return {
    type: 'assistant/attempt',
    seq: 4,
    time: T0,
    data: {
      turn,
      step,
      stream: [{ type: 'chunk', time: T0, chunk: { type: 'usage', usage } }],
    },
  }
}

function retryEvent(turn: number, step: number): FoldEvent {
  return { type: 'llm/retry-started', seq: 5, time: T0, data: { turn, step } }
}

test('message.usage 字段优先；同批 stream chunk 不双计', () => {
  const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 }
  const rows = foldUsage(
    [
      messageWithStreamUsage(1, 0, 'p', 'm', { inputTokens: 999 }),
      messageEvent(1, 0, 'p', 'm', usage),
    ],
    TZ,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.calls, 1)
  assert.equal(rows[0]?.inputTokens, 100)
  assert.equal(rows[0]?.provider, 'p')
  assert.equal(rows[0]?.model, 'm')
})

test('无 usage 字段时回落 stream 内嵌 usage chunk', () => {
  const rows = foldUsage(
    [messageWithStreamUsage(1, 0, 'openai', 'gpt', { inputTokens: 30, outputTokens: 20 })],
    TZ,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.inputTokens, 30)
  assert.equal(rows[0]?.provider, 'openai')
})

test('无 message 的 attempt 结算（失败尝试）计入「—」聚合行', () => {
  const rows = foldUsage([attemptEvent(1, 0, { inputTokens: 7 })], TZ)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.provider, '—')
  assert.equal(rows[0]?.inputTokens, 7)
  assert.equal(rows[0]?.calls, 1)
})

test('同一 (turn,step) 连续重结算：替换语义（不累加）', () => {
  const rows = foldUsage(
    [
      messageEvent(1, 0, 'a', 'x', { inputTokens: 100 }),
      messageEvent(1, 0, 'a', 'x', { inputTokens: 40 }),
    ],
    TZ,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.calls, 1)
  assert.equal(rows[0]?.inputTokens, 40)
})

test('llm/retry-started 关闭替换槽：重试尝试照常累加（失败尝试计入）', () => {
  const rows = foldUsage(
    [
      messageEvent(1, 0, 'a', 'x', { inputTokens: 100 }),
      retryEvent(1, 0),
      attemptEvent(1, 0, { inputTokens: 20 }),
      messageEvent(1, 0, 'a', 'x', { inputTokens: 30 }),
    ],
    TZ,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.calls, 2)
  assert.equal(rows[0]?.inputTokens, 130)
})

test('多 provider/model 归桶分离；同桶跨步累加', () => {
  const rows = foldUsage(
    [
      messageEvent(1, 0, 'a', 'x', { inputTokens: 10 }),
      messageEvent(1, 1, 'a', 'x', { inputTokens: 20 }),
      messageEvent(2, 0, 'b', 'y', { inputTokens: 5 }),
    ],
    TZ,
  )
  assert.equal(rows.length, 2)
  const ax = rows.find((r) => r.provider === 'a')
  const by = rows.find((r) => r.provider === 'b')
  assert.equal(ax?.calls, 2)
  assert.equal(ax?.inputTokens, 30)
  assert.equal(by?.inputTokens, 5)
})

test('跨日切分：同 provider 不同日分行（本地时区口径）', () => {
  const day1 = Date.UTC(2026, 7, 24, 20, 0) // UTC+8 = 8/25 04:00
  const day2 = Date.UTC(2026, 7, 25, 20, 0) // UTC+8 = 8/26 04:00
  const rows = foldUsage(
    [
      messageEvent(1, 0, 'a', 'm', { inputTokens: 1 }, day1),
      messageEvent(2, 0, 'a', 'm', { inputTokens: 2 }, day2),
    ],
    TZ,
  )
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0]?.date, rows[1]?.date)
  assert.equal(rows[0]?.date, '2026-08-25')
  assert.equal(rows[1]?.date, '2026-08-26')
})

test('localDay：UTC 时间按偏移折算本地日', () => {
  // UTC 2026-08-24T20:00 = UTC+8 2026-08-25T04:00
  assert.equal(localDay(Date.UTC(2026, 7, 24, 20, 0), 480), '2026-08-25')
  // 同一时刻 UTC 视角（偏移 0）仍是 08-24
  assert.equal(localDay(Date.UTC(2026, 7, 24, 20, 0), 0), '2026-08-24')
})

test('无关事件（user/message、tool/call）不产生行', () => {
  const rows = foldUsage(
    [
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 2, time: 1, data: {} },
      { type: 'tool/call', seq: 3, time: 1, data: { turn: 1, step: 0 } },
    ],
    TZ,
  )
  assert.equal(rows.length, 0)
})
