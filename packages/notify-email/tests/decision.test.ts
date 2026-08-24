import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import type { DecisionCall, NotifyEmailService } from '../src/index.ts'
import { installDecisionWatcher } from '../src/watchers/decision.ts'

interface Harness {
  emitPreExecute(callId: string, sessionId: string | undefined, name: string): void
  emitDisposed(sessionId: string): void
  dispatched: DecisionCall[]
}

interface ToolExec {
  callId: string
  name: string
  arguments?: Record<string, unknown>
  agent?: { id: string } | undefined
}

function createHarness(): Harness {
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  const dispatched: DecisionCall[] = []
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    on(event: string, fn: (...args: never[]) => void) {
      const list = listeners.get(event) ?? []
      list.push(fn)
      listeners.set(event, list)
    },
    effect(fn: () => () => void) {
      return fn()
    },
  }
  const service = {
    dispatchDecision(call: DecisionCall) {
      dispatched.push(call)
      return Promise.resolve()
    },
  }
  installDecisionWatcher(ctx as unknown as Context, service as unknown as NotifyEmailService)
  return {
    dispatched,
    emitPreExecute(callId, sessionId, name) {
      const exec: ToolExec = {
        callId,
        name,
        agent: sessionId === undefined ? undefined : { id: sessionId },
      }
      for (const fn of listeners.get('tools/pre-execute') ?? []) {
        ;(fn as (exec: ToolExec, next: () => void) => void)(exec, () => {})
      }
    },
    emitDisposed(sessionId) {
      for (const fn of listeners.get('session/disposed') ?? []) {
        ;(fn as (session: { id: string }) => void)({ id: sessionId })
      }
    },
  }
}

test('given a decision tool call, when observed, then dispatched once with session binding', () => {
  const h = createHarness()
  h.emitPreExecute('c1', 'sess-1', 'ask_user_question')
  assert.equal(h.dispatched.length, 1)
  assert.equal(h.dispatched[0]?.sessionId, 'sess-1')
  assert.equal(h.dispatched[0]?.name, 'ask_user_question')
})

test('given the same callId replayed, when observed twice, then deduped to one dispatch', () => {
  const h = createHarness()
  h.emitPreExecute('c1', 'sess-1', 'ask_user_question')
  h.emitPreExecute('c1', 'sess-1', 'ask_user_question')
  assert.equal(h.dispatched.length, 1)
})

test('given identical callIds in different sessions, when observed, then both dispatch', () => {
  const h = createHarness()
  h.emitPreExecute('c1', 'sess-1', 'ask_user_question')
  h.emitPreExecute('c1', 'sess-2', 'ask_user_question')
  assert.equal(h.dispatched.length, 2)
})

test('given a disposed session, when its bucket is cleared, then replayed callIds dispatch again', () => {
  const h = createHarness()
  h.emitPreExecute('c1', 'sess-1', 'ask_user_question')
  h.emitDisposed('sess-1')
  // 会话桶已释放：同一 callId 再次出现（新会话生命周期）应重新派发，去重表不残留
  h.emitPreExecute('c1', 'sess-1', 'ask_user_question')
  assert.equal(h.dispatched.length, 2)
})

test('given an exec without agent, when observed, then falls back to unknown bucket', () => {
  const h = createHarness()
  h.emitPreExecute('c1', undefined, 'ask_user_question')
  assert.equal(h.dispatched.length, 1)
  assert.equal(h.dispatched[0]?.sessionId, 'unknown')
})
