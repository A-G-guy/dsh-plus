/**
 * createApiScope 核心行为：generation 防旧读覆盖新发布、ns 过滤刷新、
 * unavailable 发布、订阅通知（fake api 注入，无 DOM）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createApiScope, type ScopeHostContext } from '../src/client/scope.ts'

interface DescribeResult {
  ok: boolean
  value?: {
    writable: boolean
    namespaces: Array<{ ns: string; value: unknown; revision: number; secrets: never[] }>
  }
  error?: { message?: string }
}

/** 手动受控的 fake settings api：describe 返回值可编程、失败可注入。 */
function fakeApi(views: Array<{ ns: string; value: unknown }>) {
  let fail = false
  const result: DescribeResult = {
    ok: true,
    value: {
      writable: true,
      namespaces: views.map((v, i) => ({ ...v, revision: i + 1, secrets: [] })),
    },
  }
  return {
    describe: async (): Promise<{ result: DescribeResult }> => {
      if (fail) throw new Error('network down')
      return { result }
    },
    setFail(next: boolean): void {
      fail = next
    },
  }
}

/** fake 浏览器半宿主：只记录订阅/卸载事件，effect 直通。 */
function fakeHost(): ScopeHostContext {
  return {
    get: () => ({
      $on: () => () => {},
    }),
    on: () => () => {},
    effect: (execute: () => () => void) => execute(),
  }
}

test('首次 load 发布 ready 快照（value/revision/writable 来自 describe）', async () => {
  const api = fakeApi([{ ns: 'ns-a', value: { enabled: true } }])
  const scope = createApiScope(api, 'ns-a', fakeHost(), 'test: scope')
  await scope.load()
  const snap = scope.getSnapshot()
  assert.equal(snap.status, 'ready')
  assert.deepEqual(snap.value, { enabled: true })
  assert.equal(snap.revision, 1)
  assert.equal(snap.writable, true)
})

test('命名空间缺失时发布 unavailable', async () => {
  const api = fakeApi([{ ns: 'ns-other', value: {} }])
  const scope = createApiScope(api, 'ns-a', fakeHost(), 'test: scope')
  await scope.load()
  const snap = scope.getSnapshot()
  assert.equal(snap.status, 'unavailable')
  assert.equal(snap.value, undefined)
})

test('describe 网络失败不改变已发布状态（旧读静默丢弃）', async () => {
  const api = fakeApi([{ ns: 'ns-a', value: { v: 1 } }])
  const scope = createApiScope(api, 'ns-a', fakeHost(), 'test: scope')
  await scope.load()
  const before = scope.getSnapshot()
  api.setFail(true)
  await scope.load()
  assert.equal(scope.getSnapshot(), before)
})

test('订阅者在发布时收到通知', async () => {
  const api = fakeApi([{ ns: 'ns-a', value: {} }])
  const scope = createApiScope(api, 'ns-a', fakeHost(), 'test: scope')
  let notified = 0
  scope.subscribe(() => {
    notified += 1
  })
  await scope.load()
  assert.ok(notified >= 1, 'ready 发布应通知订阅者')
})

test('ok=false 的应答不发布（保持 loading/旧状态）', async () => {
  const api = {
    describe: async () => ({ result: { ok: false, error: { message: 'denied' } } }),
  }
  const scope = createApiScope(api as never, 'ns-a', fakeHost(), 'test: scope')
  await scope.load()
  assert.equal(scope.getSnapshot().status, 'loading')
})
