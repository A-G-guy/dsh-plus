/**
 * createSettingsScope 核心行为：generation 防旧读覆盖新发布、ns 过滤刷新、
 * unavailable 发布、订阅通知（fake remote.settings 注入，无 DOM）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSettingsScope, type ScopeHostContext } from '../src/client/scope.ts'

/** 手动受控的 fake remote.settings：describe 返回值可编程、失败可注入。 */
function fakeRemote(views: Array<{ ns: string; value: unknown }>) {
  let fail = false
  const view = {
    writable: true,
    namespaces: views.map((v, i) => ({ ...v, revision: i + 1, secrets: [] })),
  }
  return {
    settings: {
      describe: async () => {
        if (fail) throw new Error('network down')
        return { ok: true, value: view }
      },
      update: async () => ({ ok: true, value: {} }),
    },
    setFail(next: boolean): void {
      fail = next
    },
  }
}

/** fake 浏览器半宿主：只记录订阅/卸载事件，effect 直通。 */
function fakeHost(remote: ReturnType<typeof fakeRemote>): ScopeHostContext {
  return {
    get: () => ({
      settings: remote.settings,
      $on: () => () => {},
    }),
    on: () => () => {},
    effect: (execute: () => () => void) => execute(),
  }
}

test('首次 load 发布 ready 快照（value/revision/writable 来自 describe）', async () => {
  const remote = fakeRemote([{ ns: 'ns-a', value: { enabled: true } }])
  const scope = createSettingsScope(fakeHost(remote), 'ns-a', 'test: scope')
  await scope.load()
  const snap = scope.getSnapshot()
  assert.equal(snap.status, 'ready')
  assert.deepEqual(snap.value, { enabled: true })
  assert.equal(snap.revision, 1)
  assert.equal(snap.writable, true)
})

test('命名空间缺失时发布 unavailable', async () => {
  const remote = fakeRemote([{ ns: 'ns-other', value: {} }])
  const scope = createSettingsScope(fakeHost(remote), 'ns-a', 'test: scope')
  await scope.load()
  const snap = scope.getSnapshot()
  assert.equal(snap.status, 'unavailable')
  assert.equal(snap.value, undefined)
})

test('describe 网络失败不改变已发布状态（旧读静默丢弃）', async () => {
  const remote = fakeRemote([{ ns: 'ns-a', value: { v: 1 } }])
  const scope = createSettingsScope(fakeHost(remote), 'ns-a', 'test: scope')
  await scope.load()
  const before = scope.getSnapshot()
  remote.setFail(true)
  await scope.load()
  assert.equal(scope.getSnapshot(), before)
})

test('订阅者在发布时收到通知', async () => {
  const remote = fakeRemote([{ ns: 'ns-a', value: {} }])
  const scope = createSettingsScope(fakeHost(remote), 'ns-a', 'test: scope')
  let notified = 0
  scope.subscribe(() => {
    notified += 1
  })
  await scope.load()
  assert.ok(notified >= 1, 'ready 发布应通知订阅者')
})

test('describe 抛错（传输异常）不发布（保持 loading/旧状态）', async () => {
  const remote = fakeRemote([])
  remote.setFail(true)
  const scope = createSettingsScope(fakeHost(remote), 'ns-a', 'test: scope')
  await scope.load()
  assert.equal(scope.getSnapshot().status, 'loading')
})
