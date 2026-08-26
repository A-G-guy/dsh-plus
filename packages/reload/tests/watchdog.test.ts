/**
 * 被动重启检测（watchdog）单测：基线建立、bootId 比对、失败保持、
 * host 下发间隔采纳与 0 关闭、并发去重、stop 后静默。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type HealthLike, startRestartWatchdog } from '../src/client/watchdog.ts'

interface Fake {
  watchdog: ReturnType<typeof startRestartWatchdog>
  reloads: number
  fetches: number
  timerMs: number | null
  fireTimer: () => Promise<void>
  setNext(h: HealthLike | Error): void
}

function fakeWatchdog(first: HealthLike): Fake {
  let next = first
  let timerFn: (() => void) | null = null
  const fake: Fake = {
    reloads: 0,
    fetches: 0,
    timerMs: null,
    watchdog: undefined as unknown as Fake['watchdog'],
    fireTimer: async () => {
      assert.ok(timerFn !== null, 'timer should be scheduled')
      timerFn()
      await new Promise((resolve) => setImmediate(resolve))
    },
    setNext(h: HealthLike | Error): void {
      next = h
    },
  }
  fake.watchdog = startRestartWatchdog({
    fetchHealth: () => {
      fake.fetches += 1
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    },
    reload: () => {
      fake.reloads += 1
    },
    fallbackIntervalMs: 30_000,
    setIntervalFn: (fn, ms) => {
      timerFn = fn
      fake.timerMs = ms
      return 1
    },
    clearIntervalFn: () => {
      timerFn = null
    },
  })
  return fake
}

const health = (bootId: string, intervalMs?: number): HealthLike => ({
  ok: true,
  bootId,
  ...(intervalMs === undefined ? {} : { watchdogIntervalMs: intervalMs }),
})

test('given 首次 health 成功，then 建立基线并按下发间隔排程，不刷新', async () => {
  const fake = fakeWatchdog(health('boot-a', 10_000))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fake.reloads, 0)
  assert.equal(fake.timerMs, 10_000)
})

test('given health 未下发间隔，then 走兜底间隔', async () => {
  const fake = fakeWatchdog(health('boot-a'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fake.timerMs, 30_000)
})

test('given 下发间隔为 0，then 不排程（被动检测关闭）', async () => {
  const fake = fakeWatchdog(health('boot-a', 0))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fake.timerMs, null)
})

test('given 基线已建，when bootId 未变，then 不刷新', async () => {
  const fake = fakeWatchdog(health('boot-a', 1000))
  await new Promise((resolve) => setImmediate(resolve))
  await fake.fireTimer()
  assert.equal(fake.reloads, 0)
})

test('given 基线已建，when bootId 变化，then 刷新一次并停止', async () => {
  const fake = fakeWatchdog(health('boot-a', 1000))
  await new Promise((resolve) => setImmediate(resolve))
  fake.setNext(health('boot-b', 1000))
  await fake.fireTimer()
  assert.equal(fake.reloads, 1)
  await fake.watchdog.checkNow()
  assert.equal(fake.reloads, 1)
  assert.equal(fake.fetches, 2)
})

test('given health 失败，then 保持基线不刷新，恢复后正常比对', async () => {
  const fake = fakeWatchdog(health('boot-a', 1000))
  await new Promise((resolve) => setImmediate(resolve))
  fake.setNext(new Error('connection refused'))
  await fake.watchdog.checkNow()
  assert.equal(fake.reloads, 0)
  fake.setNext(health('boot-b', 1000))
  await fake.watchdog.checkNow()
  assert.equal(fake.reloads, 1)
})

test('given 进行中的检查，when 再次触发，then 并发去重只发一次请求', async () => {
  const fake = fakeWatchdog(health('boot-a', 1000))
  await new Promise((resolve) => setImmediate(resolve))
  await Promise.all([fake.watchdog.checkNow(), fake.watchdog.checkNow()])
  assert.equal(fake.fetches, 2)
})

test('given stop 后，when 再检查，then 静默不发请求', async () => {
  const fake = fakeWatchdog(health('boot-a', 1000))
  await new Promise((resolve) => setImmediate(resolve))
  fake.watchdog.stop()
  await fake.watchdog.checkNow()
  assert.equal(fake.fetches, 1)
  assert.equal(fake.reloads, 0)
})
