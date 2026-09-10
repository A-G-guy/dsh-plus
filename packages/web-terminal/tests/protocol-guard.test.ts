/**
 * WebSocket 服务端帧守卫：畸形帧必须在 switch 之前被拒。
 * 背景：原实现 `JSON.parse(...) as ServerMessage` 在 try 之外进入 switch，
 * 缺 sessions 数组的帧会在 `.map()` 处抛未捕获异常，整个终端面板失效。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isServerMessage } from '../src/protocol.ts'

const SESSION = { id: 'a', name: 'a', cwd: '/', pid: 1, running: true }

test('合法帧放行（覆盖全部 kind）', () => {
  assert.equal(isServerMessage({ kind: 'attached', session: SESSION, replay: '' }), true)
  assert.equal(isServerMessage({ kind: 'detached', sessionId: 'a' }), true)
  assert.equal(isServerMessage({ kind: 'output', sessionId: 'a', data: 'x' }), true)
  assert.equal(isServerMessage({ kind: 'exit', sessionId: 'a', exitCode: 0, signal: null }), true)
  assert.equal(isServerMessage({ kind: 'sessions', sessions: [], maxSessions: 8 }), true)
  assert.equal(isServerMessage({ kind: 'error', message: 'x' }), true)
})

test('畸形 sessions 帧被拒（原崩溃场景）', () => {
  assert.equal(isServerMessage({ kind: 'sessions' }), false)
  assert.equal(isServerMessage({ kind: 'sessions', sessions: null }), false)
  assert.equal(isServerMessage({ kind: 'sessions', sessions: {} }), false)
  assert.equal(isServerMessage({ kind: 'sessions', maxSessions: 8 }), false)
})

test('畸形 attached 帧被拒（session 缺失会在 set 时崩）', () => {
  assert.equal(isServerMessage({ kind: 'attached', replay: '' }), false)
  assert.equal(isServerMessage({ kind: 'attached', session: null }), false)
})

test('非对象、未知 kind、缺 kind 一律被拒', () => {
  assert.equal(isServerMessage(null), false)
  assert.equal(isServerMessage(undefined), false)
  assert.equal(isServerMessage('text'), false)
  assert.equal(isServerMessage(42), false)
  assert.equal(isServerMessage({}), false)
  assert.equal(isServerMessage({ kind: 'unknown-future-frame' }), false)
})
