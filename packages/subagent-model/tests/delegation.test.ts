import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EFFORT_INHERIT, type SubagentModelConfig } from '../src/config.ts'
import { childEffortOf, installDelegationHook } from '../src/delegation.ts'

/** 记录每次委托调用的假子代理服务。 */
function fakeSubagents(calls: Array<{ name: string; request: unknown }>) {
  return {
    start: async (name: string, request: unknown) => {
      calls.push({ name, request })
      return { kind: 'run' }
    },
    startContinuable: async (spec: { provider: string; request: unknown }) => {
      calls.push({ name: spec.provider, request: spec.request })
      return { kind: 'start' }
    },
  }
}

/** 假 ctx：只提供 installDelegationHook 用到的最小面。 */
function fakeCtx(service: unknown) {
  const disposers: Array<() => void> = []
  return {
    get: (key: string): unknown => (key === 'subagents' ? service : undefined),
    logger: () => ({ warn: () => {} }),
    effect: (execute: () => () => void): (() => void) => {
      const dispose = execute()
      disposers.push(dispose)
      return dispose
    },
    disposers,
  }
}

const ACTIVE: SubagentModelConfig = {
  enabled: true,
  entries: {
    spawn: {
      enabled: true,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    },
    fork: {
      enabled: true,
      provider: 'kimi-coding',
      model: 'k3',
      reasoningEffort: EFFORT_INHERIT,
    },
  },
}

const INACTIVE: SubagentModelConfig = { enabled: false, entries: {} }

test('given an enabled entry, when start is called, then agentOptions are injected', async () => {
  const calls: Array<{ name: string; request: unknown }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const request = { prompt: [], parent: {}, signal: {} }
  await service.start('spawn', request)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]?.request, {
    ...request,
    agentOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    },
  })
  /* 调用方对象不被篡改 */
  assert.deepEqual(request, { prompt: [], parent: {}, signal: {} })
})

test('given an entry with inherit model, when start is called, then only the stamped fields are injected', async () => {
  const calls: Array<{ name: string; request: unknown }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const request = { prompt: [], parent: {}, signal: {} }
  await service.start('fork', request)
  assert.deepEqual(calls[0]?.request, {
    ...request,
    agentOptions: { provider: 'kimi-coding', model: 'k3' },
  })
})

test('given an unconfigured provider, when start is called, then the request passes through untouched', async () => {
  const calls: Array<{ name: string; request: unknown }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const request = { prompt: [], parent: {}, signal: {} }
  await service.start('codex', request)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.request, request)
})

test('given disabled global switch, when start is called, then behavior is fully native', async () => {
  const calls: Array<{ name: string; request: unknown }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => INACTIVE)
  const request = { prompt: [], parent: {}, signal: {} }
  await service.start('spawn', request)
  assert.equal(calls[0]?.request, request)
})

test('given an existing tool-line agentOptions, when injected, then the tool line wins on conflicts', async () => {
  const calls: Array<{ name: string; request: unknown }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const request = {
    prompt: [],
    parent: {},
    signal: {},
    agentOptions: { provider: 'openai', model: 'gpt-5.6-sol' },
  }
  await service.start('spawn', request)
  assert.deepEqual(calls[0]?.request, {
    ...request,
    agentOptions: {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
    },
  })
})

test('given startContinuable, when an entry hits, then spec.request gets the injected options', async () => {
  const calls: Array<{ name: string; request: unknown }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const spec = {
    provider: 'spawn',
    label: 'l',
    request: { prompt: [], parent: {}, signal: {} },
  }
  await service.startContinuable(spec)
  assert.deepEqual(calls[0]?.request, {
    ...spec.request,
    agentOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    },
  })
  /* 调用方 spec 不被篡改 */
  assert.deepEqual(spec.request, { prompt: [], parent: {}, signal: {} })
})

test('given a disposed hook, when start is called, then the original methods are restored', async () => {
  const calls: Array<{ name: string; request: unknown }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  const dispose = installDelegationHook(ctx as never, () => ACTIVE)
  dispose()
  const request = { prompt: [], parent: {}, signal: {} }
  await service.start('spawn', request)
  assert.equal(calls[0]?.request, request)
})

test('given a re-install, when the previous hook was not disposed, then it is rejected as duplicate', async () => {
  const calls: Array<{ name: string; request: unknown }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const second = installDelegationHook(ctx as never, () => ACTIVE)
  const request = { prompt: [], parent: {}, signal: {} }
  await service.start('spawn', request)
  assert.deepEqual(calls[0]?.request, {
    ...request,
    agentOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    },
  })
  /* 重复安装被拒后，首个挂钩仍生效（不叠包、不破坏注入） */
  second()
  const request2 = { prompt: [], parent: {}, signal: {} }
  await service.start('spawn', request2)
  assert.deepEqual(calls[1]?.request, {
    ...request2,
    agentOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    },
  })
})

test('given a main agent, when the route filter runs, then no effort is applied', () => {
  const main = {
    session: { header: { origin: undefined } },
    options: { provider: 'p', reasoningEffort: 'max' },
  }
  assert.equal(childEffortOf(main as never), undefined)
})

test('given a subagent, when the route filter runs, then its stamped effort is returned', () => {
  const spawn = {
    session: { header: { origin: 'subagent' } },
    options: { provider: 'p', reasoningEffort: 'max' },
  }
  assert.equal(childEffortOf(spawn as never), 'max')
  const unstamped = {
    session: { header: { origin: 'subagent' } },
    options: { provider: 'p' },
  }
  assert.equal(childEffortOf(unstamped as never), undefined)
  const defaultEffort = {
    session: { header: { origin: 'subagent' } },
    options: { provider: 'p', reasoningEffort: EFFORT_INHERIT },
  }
  assert.equal(childEffortOf(defaultEffort as never), EFFORT_INHERIT)
})
