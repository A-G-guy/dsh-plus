import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type MirrorLike, maybeRepairMirror, type SettingsApiLike } from '../src/client.ts'

function fakeMirror(persistence: string, status: 'idle' | 'loading' | 'ready' | 'unavailable') {
  const loads: number[] = []
  const mirror: MirrorLike = {
    persistence,
    getSnapshot: () => ({ status, view: undefined, error: null }),
    load: () => {
      loads.push(1)
      return Promise.resolve()
    },
  }
  return { mirror, loads }
}

function fakeSettings(outcome: 'ok' | 'fail' | 'throw') {
  let calls = 0
  const settings: SettingsApiLike = {
    describe: () => {
      calls += 1
      if (outcome === 'throw') return Promise.reject(new Error('network down'))
      return Promise.resolve({ result: { ok: outcome === 'ok' } })
    },
  }
  return { settings, calls: () => calls }
}

test('loopback 页面：无操作（不探测、不触碰 mirror）', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable')
  const { settings, calls } = fakeSettings('ok')
  const repaired = await maybeRepairMirror({ isLoopback: true, settings, mirror })
  assert.equal(repaired, false)
  assert.equal(calls(), 0)
  assert.equal(mirror.persistence, 'memory')
  assert.equal(loads.length, 0)
})

test('非 loopback + memory 降级 + 特权 RPC 可达：翻回 host 并触发加载', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable')
  const { settings, calls } = fakeSettings('ok')
  const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
  assert.equal(repaired, true)
  assert.equal(calls(), 1)
  assert.equal(mirror.persistence, 'host')
  assert.equal(loads.length, 1)
})

test('非 loopback + 特权 RPC 被拒（直连 LAN，无反代）：维持官方降级', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable')
  const { settings } = fakeSettings('fail')
  const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
  assert.equal(repaired, false)
  assert.equal(mirror.persistence, 'memory')
  assert.equal(loads.length, 0)
})

test('非 loopback + 探测抛错（网络异常）：维持官方降级', async () => {
  const { mirror, loads } = fakeMirror('memory', 'unavailable')
  const { settings } = fakeSettings('throw')
  const repaired = await maybeRepairMirror({ isLoopback: false, settings, mirror })
  assert.equal(repaired, false)
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
