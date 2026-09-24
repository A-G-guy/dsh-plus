import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type {
  LlmFailure,
  ResolvedNormalRetryPolicy,
  ResolvedRetryPolicy,
} from '@deepseek-ai/dsh-llm'

import {
  apply,
  Config,
  type ErrorRetryConfig,
  type Next,
  type RequestErrorPayload,
} from '../src/index.ts'

/** 上游 normal 策略的最小已解析形态（与 dsh-llm resolveRetryPolicy 输出同构）。 */
function normalPolicy(
  overrides: Partial<{
    maxRetries: number
    retryableCodes: readonly string[]
  }> = {},
): ResolvedNormalRetryPolicy {
  return Object.freeze({
    mode: 'normal' as const,
    maxRetries: overrides.maxRetries ?? 5,
    retryableCodes: Object.freeze(
      overrides.retryableCodes ?? [
        'EMPTY_RESPONSE',
        'RATE_LIMIT',
        'SERVER',
        'TIMEOUT',
        'TRANSPORT',
      ],
    ),
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    jitterRatio: 0.1,
  })
}

function failureOf(message: string, code = 'PI_AI_ERROR'): LlmFailure {
  return Object.freeze({ message, code })
}

/** 测试替身：只观察 agent/request-error 的注册形态（含 prepend 选项）。 */
function createFakeCtx() {
  const registrations: {
    event: string
    listener: (payload: RequestErrorPayload, next: Next) => Promise<unknown>
    options?: unknown
  }[] = []
  const logs: string[] = []
  const ctx = {
    logger: () => ({ info: (message: string) => logs.push(message), warn: () => {} }),
    on: (
      event: string,
      listener: (payload: RequestErrorPayload, next: Next) => Promise<unknown>,
      options?: unknown,
    ) => {
      registrations.push({ event, listener, options })
      return () => {}
    },
  }
  return { ctx: ctx as unknown as Context, registrations, logs }
}

function defaults(): ErrorRetryConfig {
  return Config({}) as ErrorRetryConfig
}

/** 走一遍「apply → 注册 → 触发监听 → 下游续接」的真实链路。 */
function runListener(
  config: ErrorRetryConfig,
  payload: RequestErrorPayload,
): { nextCalled: number; logs: string[]; registered: boolean } {
  const { ctx, registrations, logs } = createFakeCtx()
  apply(ctx, config)
  const registration = registrations.find((item) => item.event === 'agent/request-error')
  if (registration === undefined) return { nextCalled: 0, logs, registered: false }
  let nextCalled = 0
  const next: Next = () => {
    nextCalled += 1
    return Promise.resolve(undefined)
  }
  registration.listener(payload, next)
  return { nextCalled, logs, registered: true }
}

function payloadOf(
  failure: LlmFailure,
  retryPolicy: ResolvedRetryPolicy | undefined,
): RequestErrorPayload {
  return { failure, provider: 'test-provider', retryPolicy }
}

/** 上游 llm-retry 的 policyKey 组成（mode/maxRetries/排序 code/backoff 三元组）。 */
function policyKeyOf(policy: ResolvedRetryPolicy): string {
  return JSON.stringify([
    policy.mode,
    'maxRetries' in policy ? policy.maxRetries : null,
    'retryableCodes' in policy ? [...policy.retryableCodes].sort() : null,
    policy.initialDelayMs,
    policy.maxDelayMs,
    policy.jitterRatio,
  ])
}

test('Given 默认配置 When 解析 Then 启用且 5 次、默认匹配 content-filter', () => {
  const config = defaults()
  assert.equal(config.enabled, true)
  assert.equal(config.maxRetries, 5)
  assert.deepEqual(config.patterns, ['content-filter'])
})

test('Given 命中且 code 不可重试 When 监听 Then 载荷策略被改写并续接下游', () => {
  const policy = normalPolicy()
  const failure = failureOf('Provider finish_reason: content_filter')
  const payload = payloadOf(failure, policy)
  const { nextCalled, logs } = runListener(defaults(), payload)

  assert.equal(nextCalled, 1, '必须续接 next 交上游执行')
  assert.notEqual(payload.retryPolicy, policy, '应替换为新对象（原策略 frozen）')
  const rewritten = payload.retryPolicy
  assert.ok(rewritten !== undefined && 'retryableCodes' in rewritten)
  assert.ok(rewritten.retryableCodes.includes('PI_AI_ERROR'))
  assert.equal(rewritten.retryableCodes.length, 6, '仅追加一个 code，不丢失原名单')
  assert.equal(rewritten.maxRetries, 5)
  assert.equal(rewritten.initialDelayMs, 500, 'backoff 三元组原样保留')
  assert.equal(rewritten.maxDelayMs, 10_000)
  assert.equal(rewritten.jitterRatio, 0.1)
  assert.equal(policy.retryableCodes.length, 5, '原策略对象不得被就地修改')
  assert.deepEqual(
    failure,
    failureOf('Provider finish_reason: content_filter'),
    'failure 事实不得改写',
  )
  const hitLogs = logs.filter((line) => line.includes('matched'))
  assert.equal(hitLogs.length, 1, '命中改写应留一行上下文日志（不含安装日志）')
  assert.match(hitLogs[0] ?? '', /PI_AI_ERROR/)
  assert.match(hitLogs[0] ?? '', /content-filter/)
})

test('Given 上游次数配置不同 When 命中改写 Then maxRetries 取插件配置', () => {
  const payload = payloadOf(
    failureOf('Provider finish_reason: content_filter'),
    normalPolicy({ maxRetries: 2 }),
  )
  runListener({ ...defaults(), maxRetries: 3 }, payload)
  assert.ok(payload.retryPolicy !== undefined && payload.retryPolicy.mode === 'normal')
  assert.equal(payload.retryPolicy.maxRetries, 3, '匹配报错的次数以插件配置为准')
})

test('Given 不命中模式 When 监听 Then 载荷原样旁路', () => {
  const policy = normalPolicy()
  const payload = payloadOf(failureOf('connection reset by peer', 'TRANSPORT'), policy)
  const { nextCalled, logs } = runListener(defaults(), payload)
  assert.equal(payload.retryPolicy, policy, '未命中必须保持原引用')
  assert.equal(nextCalled, 1)
  assert.equal(logs.filter((line) => line.includes('matched')).length, 0)
})

test('Given always 模式 When 命中 Then 旁路上游（上游已无条件重试）', () => {
  const policy: ResolvedRetryPolicy = Object.freeze({
    mode: 'always' as const,
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    jitterRatio: 0.1,
  })
  const payload = payloadOf(failureOf('Provider finish_reason: content_filter'), policy)
  const { nextCalled } = runListener(defaults(), payload)
  assert.equal(payload.retryPolicy, policy, 'always 模式不改写')
  assert.equal(nextCalled, 1)
})

test('Given 无策略（适配器选择前失败）When 命中 Then 旁路', () => {
  const payload = payloadOf(failureOf('Provider finish_reason: content_filter'), undefined)
  const { nextCalled } = runListener(defaults(), payload)
  assert.equal(payload.retryPolicy, undefined)
  assert.equal(nextCalled, 1)
})

test('Given code 已在 retryableCodes When 命中 Then 旁路（不越权改上游预算）', () => {
  const policy = normalPolicy({ retryableCodes: ['EMPTY_RESPONSE', 'PI_AI_ERROR'] })
  const payload = payloadOf(failureOf('Provider finish_reason: content_filter'), policy)
  const { nextCalled, logs } = runListener(defaults(), payload)
  assert.equal(payload.retryPolicy, policy, '上游已覆盖该 code，保持原引用')
  assert.equal(nextCalled, 1)
  assert.equal(logs.filter((line) => line.includes('matched')).length, 0)
})

test('Given 模糊与正则模式 When 匹配实际消息 Then 各形态均命中且无关消息不命中', () => {
  const message = 'Provider finish_reason: content_filter'
  const cases: [pattern: string, shouldHit: boolean][] = [
    ['content-filter', true],
    ['CONTENT_FILTER', true],
    ['finish reason', true],
    ['/finish_reason/i', true],
    ['/content[-_]filter/', true],
    ['rate limit', false],
    ['/quota.exceeded/i', false],
  ]
  for (const [pattern, shouldHit] of cases) {
    const { registrations, ctx } = createFakeCtx()
    apply(ctx, { ...defaults(), patterns: [pattern] })
    const registration = registrations.find((item) => item.event === 'agent/request-error')
    assert.ok(registration !== undefined, `模式 ${pattern} 应完成注册`)
    const policy = normalPolicy()
    const payload = payloadOf(failureOf(message), policy)
    let nextCalled = 0
    registration.listener(payload, () => {
      nextCalled += 1
      return Promise.resolve(undefined)
    })
    assert.equal(payload.retryPolicy !== policy, shouldHit, `模式 ${pattern} 命中期望 ${shouldHit}`)
    assert.equal(nextCalled, 1, '无论命中与否都必须续接')
  }
})

test('Given 空模式列表 When 监听 Then 恒旁路', () => {
  const policy = normalPolicy()
  const payload = payloadOf(failureOf('Provider finish_reason: content_filter'), policy)
  const { nextCalled } = runListener({ ...defaults(), patterns: [] }, payload)
  assert.equal(payload.retryPolicy, policy)
  assert.equal(nextCalled, 1)
})

test('Given enabled=false When apply Then 不注册任何监听', () => {
  const { ctx, registrations } = createFakeCtx()
  apply(ctx, { ...defaults(), enabled: false })
  assert.equal(registrations.length, 0, '禁用时等价插件缺席')
})

test('Given 正常安装 When 注册 Then 抢在上游之前（prepend）且事件名正确', () => {
  const { ctx, registrations } = createFakeCtx()
  apply(ctx, defaults())
  assert.equal(registrations.length, 1)
  const registration = registrations[0]
  assert.ok(registration !== undefined)
  assert.equal(registration.event, 'agent/request-error')
  assert.deepEqual(
    registration.options,
    { prepend: true },
    '必须 prepend 才能赶在 dsh-llm-retry 裁定前改写载荷',
  )
})

test('Given 同一失败反复到达 When 两次改写 Then policyKey 组成一致（预算不断裂）', () => {
  const first = normalPolicy()
  const second = normalPolicy()
  const failure = failureOf('Provider finish_reason: content_filter')
  const config = { ...defaults(), maxRetries: 4 }

  const payloadA = payloadOf(failure, first)
  const payloadB = payloadOf(failure, second)
  runListener(config, payloadA)
  runListener(config, payloadB)

  assert.ok(payloadA.retryPolicy !== undefined && payloadB.retryPolicy !== undefined)
  assert.equal(
    policyKeyOf(payloadA.retryPolicy),
    policyKeyOf(payloadB.retryPolicy),
    '同输入两次改写的 retryPolicyKey 必须一致，否则上游次数预算每轮归零',
  )
  assert.notEqual(
    policyKeyOf(payloadA.retryPolicy),
    policyKeyOf(normalPolicy()),
    '改写后的 key 应区别于原策略（自成预算链）',
  )
})
