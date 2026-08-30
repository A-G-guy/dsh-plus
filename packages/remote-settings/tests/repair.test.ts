import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type MirrorLike, maybeRepairMirror, type SettingsApiLike } from '../src/client.ts'

function fakeMirror(
  persistence: string | undefined,
  status: 'idle' | 'loading' | 'ready' | 'unavailable',
  withLoad = true,
) {
  const loads: number[] = []
  const mirror: MirrorLike = {
    persistence,
    getSnapshot: () => ({ status, view: undefined, error: null }),
    ...(withLoad
      ? {
          load: () => {
            loads.push(1)
            return Promise.resolve()
          },
        }
      : {}),
  }
  return { mirror, loads }
}

function fakeSettings(outcome: 'ok' | 'fail' | 'throw') {
  let calls = 0
  const settings: SettingsApiLike = {
    describe: () => {
      calls += 1
      if (outcome === 'throw') return Promise.reject(new Error('network down'))
      return Promise.resolve({ ok: outcome === 'ok' })
    },
  }
  return { settings, calls: () => calls }
}

// ── 行为 1：memory 降级下的无操作（loopback 页 / 非降级 mirror 均不探测） ──

test('loopback 页面：无操作（不探测、不触碰 mirror）', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable')
  const { settings, calls } = fakeSettings('ok')
  const repaired = await maybeRepairMirror({ isLoopback: true, settings, mirror })
  assert.equal(repaired, false)
  assert.equal(calls(), 0)
  assert.equal(mirror.persistence, 'memory')
  assert.equal(loads.length, 0)
})

test('mirror 非 memory 降级（host 模式或已有视图）：无操作', async () => {
  for (const [persistence, status] of [
    ['host', 'idle'],
    ['host', 'ready'],
    ['memory', 'ready'],
  ] as const) {
    const { mirror, loads } = fakeMirror(persistence, status)
    const { settings, calls } = fakeSettings('ok')
    const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
    assert.equal(repaired, false)
    assert.equal(calls(), 0)
    assert.equal(mirror.persistence, persistence)
    assert.equal(loads.length, 0)
  }
})

// ── 行为 2：探活可达翻转（非 loopback + memory 降级 + RPC 可达） ──

test('非 loopback + memory 降级 + 设置 RPC 可达：翻回 host 并触发加载', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable')
  const { settings, calls } = fakeSettings('ok')
  const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
  assert.equal(repaired, true)
  assert.equal(calls(), 1)
  assert.equal(mirror.persistence, 'host')
  assert.equal(loads.length, 1)
})

// ── 行为 3：不可达 no-op（直连 LAN / 网络异常） ──

test('非 loopback + 设置 RPC 被拒（直连 LAN，无反代）：维持官方降级', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable')
  const { settings } = fakeSettings('fail')
  const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
  assert.equal(repaired, false)
  assert.equal(mirror.persistence, 'memory')
  assert.equal(loads.length, 0)
})

test('非 loopback + 探测抛错（网络异常/未认证）：维持官方降级', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable')
  const { settings } = fakeSettings('throw')
  const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
  assert.equal(repaired, false)
  assert.equal(mirror.persistence, 'memory')
  assert.equal(loads.length, 0)
})

// ── 行为 4：属性漂移 no-op（上游面缺失即不修，也不探测） ──

test('mirror 漂移（persistence 属性缺失）：无操作且不探测', async () => {
  const { mirror, loads } = fakeMirror(undefined, 'unavailable')
  const { settings, calls } = fakeSettings('ok')
  const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
  assert.equal(repaired, false)
  assert.equal(calls(), 0)
  assert.equal(mirror.persistence, undefined)
  assert.equal(loads.length, 0)
})

test('mirror 漂移（load 方法缺失）：无操作且不探测', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable', false)
  const { settings, calls } = fakeSettings('ok')
  const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
  assert.equal(repaired, false)
  assert.equal(calls(), 0)
  assert.equal(mirror.persistence, 'memory')
  assert.equal(loads.length, 0)
})
