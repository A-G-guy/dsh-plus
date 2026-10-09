import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EFFORT_INHERIT, type SubagentModelConfig } from '../src/config.ts'
import { installDelegationHook } from '../src/delegation.ts'

/** 委托激活规范（官方 SubagentActivationSpec 的最小面）。 */
interface ActivationSpec {
  provider: string
  label: string
  request: { prompt: unknown[]; parent: unknown; signal: unknown; agentOptions?: unknown }
  delivery: 'parent' | 'caller'
}

/** 记录每次委托创建调用的假子代理服务。 */
function fakeSubagents(calls: Array<{ provider: string; spec: ActivationSpec }>) {
  return {
    startActivation: async (spec: ActivationSpec) => {
      calls.push({ provider: spec.provider, spec })
      return { childId: 'child-1' }
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

/** 构造一次委托创建调用（可覆写 request 以模拟调用方显式路由）。 */
function spec(provider: string, request?: Record<string, unknown>): ActivationSpec {
  return {
    provider,
    label: 'task',
    request: { prompt: [], parent: {}, signal: {}, ...request },
    delivery: 'parent',
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

test('given an enabled entry, when startActivation is called, then agentOptions are injected', async () => {
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const input = spec('spawn')
  await service.startActivation(input)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]?.spec.request, {
    ...input.request,
    agentOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    },
  })
  /* 调用方对象不被篡改 */
  assert.deepEqual(input.request, { prompt: [], parent: {}, signal: {} })
})

test('given an entry with inherit model, when startActivation is called, then only the stamped fields are injected', async () => {
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const input = spec('fork')
  await service.startActivation(input)
  assert.deepEqual(calls[0]?.spec.request, {
    ...input.request,
    agentOptions: { provider: 'kimi-coding', model: 'k3' },
  })
})

test('given an injected activation, when it is forwarded, then the remaining spec fields are preserved', async () => {
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const input: ActivationSpec = { ...spec('spawn'), delivery: 'caller' }
  await service.startActivation(input)
  assert.equal(calls[0]?.spec.provider, 'spawn')
  assert.equal(calls[0]?.spec.label, 'task')
  assert.equal(calls[0]?.spec.delivery, 'caller')
})

test('given a default entry, when an unconfigured provider starts, then the default route is injected', async () => {
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ({
    enabled: true,
    entries: {
      default: {
        enabled: true,
        provider: 'newapi-chatds',
        model: 'deepseek-v4-flash',
        reasoningEffort: EFFORT_INHERIT,
      },
    },
  }))
  const input = spec('spawn')
  await service.startActivation(input)
  assert.deepEqual(calls[0]?.spec.request, {
    ...input.request,
    agentOptions: { provider: 'newapi-chatds', model: 'deepseek-v4-flash' },
  })
})

test('given an unconfigured provider without a default entry, when startActivation is called, then the spec passes through untouched', async () => {
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const input = spec('codex')
  await service.startActivation(input)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.spec, input)
})

test('given disabled global switch, when startActivation is called, then behavior is fully native', async () => {
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => INACTIVE)
  const input = spec('spawn')
  await service.startActivation(input)
  assert.equal(calls[0]?.spec, input)
})

test('given explicit caller agentOptions, when injected, then the explicit route wins on conflicts', async () => {
  // 主代理显式选择的路由（官方 subagent-model-selection 的 model 字段）必须优先：
  // provider/model 取显式值，插件只补空缺（此处补条目配置的 effort 档位）。
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const input = spec('spawn', { agentOptions: { provider: 'openai', model: 'gpt-5.6-sol' } })
  await service.startActivation(input)
  assert.deepEqual(calls[0]?.spec.request, {
    ...input.request,
    agentOptions: {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
    },
  })
})

test('given a disposed hook, when startActivation is called, then the original method is restored', async () => {
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  const dispose = installDelegationHook(ctx as never, () => ACTIVE)
  dispose()
  const input = spec('spawn')
  await service.startActivation(input)
  assert.equal(calls[0]?.spec, input)
})

test('given a re-install, when the previous hook was not disposed, then it is rejected as duplicate', async () => {
  const calls: Array<{ provider: string; spec: ActivationSpec }> = []
  const service = fakeSubagents(calls)
  const ctx = fakeCtx(service)
  installDelegationHook(ctx as never, () => ACTIVE)
  const second = installDelegationHook(ctx as never, () => ACTIVE)
  await service.startActivation(spec('spawn'))
  assert.deepEqual(calls[0]?.spec.request.agentOptions, {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'max',
  })
  /* 重复安装被拒后，首个挂钩仍生效（不叠包、不破坏注入） */
  second()
  const request2 = { prompt: [], parent: {}, signal: {} }
  await service.startActivation({ ...spec('spawn'), request: request2 })
  assert.deepEqual(calls[1]?.spec.request, {
    ...request2,
    agentOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    },
  })
})

test('given no subagents service, when the hook installs, then it warns and skips', () => {
  const ctx = fakeCtx(undefined)
  let warned = false
  ctx.logger = () => ({
    warn: () => {
      warned = true
    },
  })
  const dispose = installDelegationHook(ctx as never, () => ACTIVE)
  assert.equal(warned, true)
  dispose()
})
