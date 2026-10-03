import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runInProcessReload, unsupportedReasons } from '../src/inprocess.ts'

const CAPS_OK = { profile: true, hmr: true, pluginPackages: true }
const CAPS_NO_PROFILE = { profile: false, hmr: false, pluginPackages: false }

test('given no profile context, when reload, then unsupported and nothing is read', async () => {
  let read = false
  const outcome = await runInProcessReload<string[]>({
    capabilities: CAPS_NO_PROFILE,
    refreshPackages: undefined,
    readPatches: () => {
      read = true
      return []
    },
    reconcile: () => Promise.resolve([]),
    exclusive: undefined,
  })
  assert.equal(outcome.kind, 'unsupported')
  assert.equal(read, false)
  assert.deepEqual(
    outcome.kind === 'unsupported' ? outcome.reasons : [],
    unsupportedReasons(CAPS_NO_PROFILE),
  )
})

test('given refresh and reconcile both available, when reload, then refresh precedes reconcile', async () => {
  const order: string[] = []
  const outcome = await runInProcessReload<string[]>({
    capabilities: CAPS_OK,
    refreshPackages: async () => {
      order.push('refresh')
    },
    readPatches: () => {
      order.push('read')
      return ['patch']
    },
    reconcile: (patches) => {
      order.push(`reconcile:${patches.join(',')}`)
      return Promise.resolve(['既有条目 inactive: dsh-plus-x'])
    },
    exclusive: undefined,
  })
  assert.deepEqual(order, ['refresh', 'read', 'reconcile:patch'])
  assert.equal(outcome.kind, 'applied')
  assert.deepEqual(outcome.kind === 'applied' ? outcome.warnings : [], [
    '既有条目 inactive: dsh-plus-x',
  ])
})

test('given refresh fails, when reload, then warning recorded and reconcile still runs', async () => {
  let reconciled = false
  const outcome = await runInProcessReload<string[]>({
    capabilities: CAPS_OK,
    refreshPackages: () => Promise.reject(new Error('解析表不可读')),
    readPatches: () => [],
    reconcile: () => {
      reconciled = true
      return Promise.resolve([])
    },
    exclusive: undefined,
  })
  assert.equal(reconciled, true)
  assert.equal(outcome.kind, 'applied')
  assert.deepEqual(outcome.kind === 'applied' ? outcome.warnings : [], [
    '包解析表刷新失败：解析表不可读',
  ])
})

test('given exclusive queue, when reload, then work runs inside it', async () => {
  const events: string[] = []
  const outcome = await runInProcessReload<string[]>({
    capabilities: CAPS_OK,
    refreshPackages: undefined,
    readPatches: () => [],
    reconcile: () => Promise.resolve([]),
    exclusive: async (operation) => {
      events.push('enter')
      const value = await operation()
      events.push('leave')
      return value
    },
  })
  assert.deepEqual(events, ['enter', 'leave'])
  assert.equal(outcome.kind, 'applied')
})

test('given reconcile rejects, when reload, then failed carries the message', async () => {
  const outcome = await runInProcessReload<string[]>({
    capabilities: CAPS_OK,
    refreshPackages: undefined,
    readPatches: () => [],
    reconcile: () => Promise.reject(new Error('dsh: 新增条目 dsh-plus-bad 未激活')),
    exclusive: undefined,
  })
  assert.deepEqual(outcome, { kind: 'failed', message: 'dsh: 新增条目 dsh-plus-bad 未激活' })
})

test('given readPatches throws, when reload, then failed instead of throwing', async () => {
  const outcome = await runInProcessReload<string[]>({
    capabilities: CAPS_OK,
    refreshPackages: undefined,
    readPatches: () => {
      throw new Error('cordis.patch.yml 不可解析')
    },
    reconcile: () => Promise.resolve([]),
    exclusive: undefined,
  })
  assert.deepEqual(outcome, { kind: 'failed', message: 'cordis.patch.yml 不可解析' })
})
