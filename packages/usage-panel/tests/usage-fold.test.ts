/**
 * usage 折叠器：chunk 优先 / message 兜底不双计、provider/model 归桶、跨日切分。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type FoldEvent, foldUsage, localDay } from '../src/usage-fold.ts'

const TZ = 480 // UTC+8（本机服务器时区）

function chunkEvent(
  turn: number,
  step: number,
  usage: object,
  time = Date.UTC(2026, 7, 25, 2, 0),
): FoldEvent {
  return {
    type: 'assistant/chunk',
    seq: 1,
    time,
    data: { turn, step, chunk: { type: 'usage', usage } },
  }
}

function messageEvent(
  turn: number,
  step: number,
  provider: string,
  model: string,
  usage: object | null,
  time = Date.UTC(2026, 7, 25, 2, 0),
): FoldEvent {
  return {
    type: 'assistant/message',
    seq: 2,
    time,
    data: {
      turn,
      step,
      message: { source: { kind: 'model', provider, model } },
      ...(usage === null ? {} : { usage }),
    },
  }
}

test('同一步 usage chunk + message.usage：只计 chunk 一次（不双计）', () => {
  const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 }
  const rows = foldUsage([chunkEvent(1, 0, usage), messageEvent(1, 0, 'p', 'm', usage)], TZ)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.calls, 1)
  assert.equal(rows[0]?.inputTokens, 100)
  assert.equal(rows[0]?.provider, 'p')
  assert.equal(rows[0]?.model, 'm')
})

test('无 usage chunk 的 committed step：message.usage 兜底计账', () => {
  const rows = foldUsage(
    [messageEvent(1, 1, 'openai', 'gpt', { inputTokens: 30, outputTokens: 20 })],
    TZ,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.calls, 1)
  assert.equal(rows[0]?.inputTokens, 30)
  assert.equal(rows[0]?.provider, 'openai')
})

test('多 provider/model 归桶分离；同桶跨步累加', () => {
  const rows = foldUsage(
    [
      chunkEvent(1, 0, { inputTokens: 10, outputTokens: 1 }),
      messageEvent(1, 0, 'a', 'x', null),
      chunkEvent(1, 1, { inputTokens: 20, outputTokens: 2 }),
      messageEvent(1, 1, 'a', 'x', null),
      chunkEvent(2, 0, { inputTokens: 5, outputTokens: 0 }),
      messageEvent(2, 0, 'b', 'y', null),
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
      chunkEvent(1, 0, { inputTokens: 1 }, day1),
      messageEvent(1, 0, 'a', 'm', null, day1),
      chunkEvent(2, 0, { inputTokens: 2 }, day2),
      messageEvent(2, 0, 'a', 'm', null, day2),
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
