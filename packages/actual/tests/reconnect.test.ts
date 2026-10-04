import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  backoffDelay,
  ReconnectScheduler,
  type ReconnectTimers,
  type TimerHandle,
} from '../src/reconnect.ts'

/** 假定时器：记录待执行任务的延时，可手动触发或断言被清理。 */
function fakeTimers(): {
  timers: ReconnectTimers
  delays: () => number[]
  fire: () => void
  cleared: () => number
} {
  let nextId = 1
  let cleared = 0
  const handles = new Map<number, { fn: () => void; delayMs: number }>()
  return {
    timers: {
      set(fn, delayMs) {
        const id = nextId
        nextId += 1
        handles.set(id, { fn, delayMs })
        return { unref: () => {}, id } as TimerHandle & { id: number }
      },
      clear(handle) {
        handles.delete((handle as { id: number }).id)
        cleared += 1
      },
    },
    delays: () => [...handles.values()].map((handle) => handle.delayMs),
    fire() {
      const pending = [...handles.entries()]
      handles.clear()
      for (const [, handle] of pending) handle.fn()
    },
    cleared: () => cleared,
  }
}

test('given an attempt index, when computing the delay, then it doubles and saturates', () => {
  assert.equal(backoffDelay(0, 1_000, 30_000), 1_000)
  assert.equal(backoffDelay(1, 1_000, 30_000), 2_000)
  assert.equal(backoffDelay(4, 1_000, 30_000), 16_000)
  assert.equal(backoffDelay(5, 1_000, 30_000), 30_000, '封顶后不再增长')
  assert.equal(backoffDelay(20, 1_000, 30_000), 30_000)
})

test('given a schedule, when the timer fires, then exactly one attempt is made', () => {
  const clock = fakeTimers()
  let attempts = 0
  const scheduler = new ReconnectScheduler({
    timers: clock.timers,
    onAttempt: () => {
      attempts += 1
    },
    onGiveUp: () => {},
  })
  scheduler.schedule()
  assert.deepEqual(clock.delays(), [1_000])
  clock.fire()
  assert.equal(attempts, 1)
  assert.equal(scheduler.failures, 1)
})

test('given a pending retry, when scheduled again, then the second call is a no-op', () => {
  const clock = fakeTimers()
  let attempts = 0
  const scheduler = new ReconnectScheduler({
    timers: clock.timers,
    onAttempt: () => {
      attempts += 1
    },
    onGiveUp: () => {},
  })
  scheduler.schedule()
  scheduler.schedule()
  assert.equal(clock.delays().length, 1, '待执行期间不得堆叠定时器')
  clock.fire()
  assert.equal(attempts, 1)
})

test('given consecutive failures, when the budget runs out, then it gives up exactly once', () => {
  const clock = fakeTimers()
  let attempts = 0
  const gaveUp: number[] = []
  const scheduler = new ReconnectScheduler({
    timers: clock.timers,
    baseMs: 10,
    maxMs: 40,
    maxAttempts: 3,
    onAttempt: () => {
      attempts += 1
      scheduler.schedule()
    },
    onGiveUp: (failures) => gaveUp.push(failures),
  })
  scheduler.schedule()
  for (let i = 0; i < 5; i += 1) {
    clock.fire()
    if (clock.delays().length > 0) continue
    scheduler.schedule()
  }
  assert.equal(attempts, 3, '达到上限后不再发起新尝试')
  assert.deepEqual(gaveUp, [3], '只告警一次')
  assert.deepEqual(clock.delays(), [])
})

test('given a saturated backoff, when scheduling repeatedly, then the delay stops growing', () => {
  const clock = fakeTimers()
  const scheduler = new ReconnectScheduler({
    timers: clock.timers,
    baseMs: 10,
    maxMs: 40,
    maxAttempts: 5,
    onAttempt: () => {},
    onGiveUp: () => {},
  })
  const seen: number[] = []
  for (let i = 0; i < 4; i += 1) {
    scheduler.schedule()
    seen.push(clock.delays()[0] ?? 0)
    clock.fire()
  }
  assert.deepEqual(seen, [10, 20, 40, 40])
})

test('given a successful discovery, when reset, then the failure budget is restored', () => {
  const clock = fakeTimers()
  const gaveUp: number[] = []
  const scheduler = new ReconnectScheduler({
    timers: clock.timers,
    maxAttempts: 2,
    onAttempt: () => {},
    onGiveUp: (failures) => gaveUp.push(failures),
  })
  scheduler.schedule()
  clock.fire()
  scheduler.schedule()
  clock.fire()
  assert.equal(scheduler.failures, 2)
  scheduler.reset()
  assert.equal(scheduler.failures, 0)
  scheduler.schedule()
  assert.equal(clock.delays().length, 1, '复位后应能继续调度')
  assert.deepEqual(gaveUp, [])
})

test('given a pending retry, when stopped, then the timer is cleared and nothing fires', () => {
  const clock = fakeTimers()
  let attempts = 0
  const scheduler = new ReconnectScheduler({
    timers: clock.timers,
    onAttempt: () => {
      attempts += 1
    },
    onGiveUp: () => {},
  })
  scheduler.schedule()
  scheduler.stop()
  assert.equal(clock.cleared(), 1)
  clock.fire()
  assert.equal(attempts, 0)
  scheduler.schedule()
  assert.deepEqual(clock.delays(), [], '停止后不得再调度')
})
