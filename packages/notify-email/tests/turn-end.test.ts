import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import type { NotifyEmailConfig } from '../src/config.ts'
import type { NotifyEmailService } from '../src/service.ts'
import type { TurnEndInfo } from '../src/triggers/types.ts'
import { extractDeliveryText, installTurnEndWatcher } from '../src/watchers/turn-end.ts'

const DEBOUNCE_MS = 5

interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  inbox: { hasPending: boolean }
}

interface Harness {
  emit(type: string, data: unknown): void
  emitDisposed(): void
  dispatched: TurnEndInfo[]
  agent: FakeAgent
  setRoot(isRoot: boolean): void
}

function createHarness(overrides?: { agent?: Partial<FakeAgent>; isRoot?: boolean }): Harness {
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  const agent: FakeAgent = {
    id: 'sess-1',
    status: 'idle',
    inbox: { hasPending: false },
    ...overrides?.agent,
  }
  let isRoot = overrides?.isRoot ?? true
  const dispatched: TurnEndInfo[] = []
  const ctx = {
    agents: {
      get: (id: string) => (id === agent.id ? agent : undefined),
      roots: () => (isRoot ? [agent] : []),
    },
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
    dispatchTurnEnd(info: TurnEndInfo) {
      dispatched.push(info)
      return Promise.resolve()
    },
  }
  const session = { id: 'sess-1' }
  installTurnEndWatcher(
    ctx as unknown as Context,
    service as unknown as NotifyEmailService,
    () => ({ idleDebounceMs: DEBOUNCE_MS }) as NotifyEmailConfig,
  )
  return {
    dispatched,
    agent,
    setRoot(value) {
      isRoot = value
    },
    emit(type, data) {
      for (const fn of listeners.get('session/event') ?? []) {
        ;(fn as (s: unknown, e: unknown) => void)(session, { type, data })
      }
    },
    emitDisposed() {
      for (const fn of listeners.get('session/disposed') ?? []) {
        ;(fn as (s: unknown) => void)(session)
      }
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assistantMessage(text: string) {
  return { message: { content: [{ type: 'text', text }] } }
}

test('given text and tool blocks, when extracting delivery, then only text blocks join', () => {
  const text = extractDeliveryText([
    { type: 'text', text: '第一段' },
    { type: 'tool_call', name: 'bash' },
    { type: 'text', text: '第二段' },
  ])
  assert.equal(text, '第一段\n第二段')
  assert.equal(extractDeliveryText([{ type: 'tool_call' }]), undefined)
})

test('given assistant message then completed turn, when idle debounce passes, then notified with delivery', async () => {
  const h = createHarness()
  h.emit('assistant/message', assistantMessage('最终交付内容'))
  h.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await sleep(DEBOUNCE_MS * 6)
  assert.equal(h.dispatched.length, 1)
  assert.equal(h.dispatched[0]?.kind, 'completed')
  assert.equal(h.dispatched[0]?.lastDelivery, '最终交付内容')
})

test('given a new turn starting inside the debounce window, when it arrives, then notification is cancelled', async () => {
  const h = createHarness()
  h.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  h.emit('turn/start', { turn: 2 })
  await sleep(DEBOUNCE_MS * 6)
  assert.equal(h.dispatched.length, 0)
})

test('given the same turn end replayed, when dedup applies, then only one notification', async () => {
  const h = createHarness()
  const end = { turn: 4, reason: { kind: 'error', error: { message: 'boom' } } }
  h.emit('turn/end', end)
  await sleep(DEBOUNCE_MS * 6)
  h.emit('turn/end', end)
  await sleep(DEBOUNCE_MS * 6)
  assert.equal(h.dispatched.length, 1)
  assert.equal(h.dispatched[0]?.errorMessage, 'boom')
})

test('given non-notify kinds, when turn ends blocked or max-tokens, then nothing fires', async () => {
  const h = createHarness()
  h.emit('turn/end', { turn: 1, reason: { kind: 'blocked' } })
  h.emit('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
  await sleep(DEBOUNCE_MS * 6)
  assert.equal(h.dispatched.length, 0)
})

test('given a non-root (subagent) session, when its turn ends, then skipped', async () => {
  const h = createHarness({ isRoot: false })
  h.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await sleep(DEBOUNCE_MS * 6)
  assert.equal(h.dispatched.length, 0)
})

test('given pending inbox work, when debounce fires, then skipped (task not actually settled)', async () => {
  const h = createHarness({ agent: { inbox: { hasPending: true } } })
  h.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await sleep(DEBOUNCE_MS * 6)
  assert.equal(h.dispatched.length, 0)
})

test('given a running agent at fire time, when debounce fires, then skipped', async () => {
  const h = createHarness()
  h.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  h.agent.status = 'running'
  await sleep(DEBOUNCE_MS * 6)
  assert.equal(h.dispatched.length, 0)
})

test('given a pending timer, when the session is disposed, then the timer is cancelled', async () => {
  const h = createHarness()
  h.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  h.emitDisposed()
  await sleep(DEBOUNCE_MS * 6)
  assert.equal(h.dispatched.length, 0)
})
