/**
 * 「一键添加」前置判定：route 生效协议推断与四类禁加原因。
 * 这些判定决定"加不加得进去"，错了要么点了必保存失败（协议冲突），
 * 要么白点（重复），故逐条锁住。
 * @module @dsh-plus/llm-pi/tests/route-fit
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { WireModelInfo } from '../src/client/api.ts'
import { emptyProviderDraft, type ProviderDraft } from '../src/client/draft.ts'
import {
  addEligibility,
  entryReference,
  isPiRoute,
  routeApiFacts,
  targetRoutes,
} from '../src/client/route-fit.ts'

/** 目录协议索引夹具：两个 provider、三种协议。 */
const apis = {
  deepseek: { 'deepseek-flash': 'openai-completions', 'deepseek-v4-pro': 'openai-completions' },
  'kimi-coding': { k3: 'anthropic-messages' },
  openai: { 'gpt-5.6-sol': 'openai-responses' },
}

function model(path: string, api: string, servable = true): WireModelInfo {
  const [provider, id] = path.split('/') as [string, string]
  return {
    provider,
    id,
    path,
    name: id,
    api,
    baseUrl: 'https://example.invalid',
    contextWindow: 1000,
    maxTokens: 100,
    input: ['text'],
    reasoning: false,
    rest: {},
    servable,
  }
}

function providerWith(patch: Partial<ProviderDraft>): ProviderDraft {
  return { ...emptyProviderDraft(), ...patch }
}

test('entryReference：显式 provider/model 取两段；裸 id 随 route 级 extends；无 extends 按同名模型', () => {
  assert.deepEqual(entryReference({ id: 'a', extends: 'deepseek/deepseek-flash' }, ''), {
    provider: 'deepseek',
    model: 'deepseek-flash',
  })
  assert.deepEqual(entryReference({ id: 'a', extends: 'deepseek-flash' }, 'kimi-coding'), {
    provider: 'kimi-coding',
    model: 'deepseek-flash',
  })
  assert.deepEqual(entryReference({ id: 'k3', extends: '' }, 'kimi-coding'), {
    provider: 'kimi-coding',
    model: 'k3',
  })
  assert.deepEqual(entryReference({ id: 'x', extends: '' }, ''), { provider: '', model: 'x' })
})

test('routeApiFacts：显式 api 优先；否则由模型继承值收敛出唯一协议', () => {
  assert.deepEqual(routeApiFacts(providerWith({ api: 'openai-responses' }), apis), {
    api: 'openai-responses',
    mixed: false,
    unresolved: 0,
  })
  // 别名条目（id 与引用目标不同名）也必须按引用目标解析出协议
  const byModels = routeApiFacts(
    providerWith({
      models: [{ ...emptyModelEntry('flash-alias'), extends: 'deepseek/deepseek-flash' }],
    }),
    apis,
  )
  assert.deepEqual(byModels, { api: 'openai-completions', mixed: false, unresolved: 0 })
  // 裸 id + route 级 extends 源同样能推断
  const byRouteExtends = routeApiFacts(
    providerWith({ extends: 'kimi-coding', models: [emptyModelEntry('k3')] }),
    apis,
  )
  assert.deepEqual(byRouteExtends, { api: 'anthropic-messages', mixed: false, unresolved: 0 })
})

test('routeApiFacts：协议混合 / 无法判定分别标记', () => {
  const mixed = routeApiFacts(
    providerWith({
      models: [
        { ...emptyModelEntry('a'), extends: 'deepseek/deepseek-flash' },
        { ...emptyModelEntry('b'), extends: 'kimi-coding/k3' },
      ],
    }),
    apis,
  )
  assert.equal(mixed.api, undefined)
  assert.equal(mixed.mixed, true)
  const unresolved = routeApiFacts(providerWith({ models: [emptyModelEntry('mystery')] }), apis)
  assert.equal(unresolved.api, undefined)
  assert.equal(unresolved.mixed, false)
  assert.equal(unresolved.unresolved, 1)
})

test('isPiRoute / targetRoutes：adapter: deepseek 的 route 不作为添加目标', () => {
  assert.equal(isPiRoute(providerWith({})), true)
  assert.equal(isPiRoute(providerWith({ extra: { adapter: 'pi' } })), true)
  assert.equal(isPiRoute(providerWith({ extra: { adapter: 'deepseek' } })), false)
  assert.deepEqual(
    targetRoutes({
      zeta: providerWith({}),
      alpha: providerWith({}),
      ds: providerWith({ extra: { adapter: 'deepseek' } }),
    }),
    ['alpha', 'zeta'],
  )
})

test('addEligibility：可服务且协议一致时可添加', () => {
  const result = addEligibility({
    model: model('deepseek/deepseek-flash', 'openai-completions'),
    provider: providerWith({
      models: [{ ...emptyModelEntry('deepseek-v4-pro'), extends: 'deepseek/deepseek-v4-pro' }],
    }),
    apis,
  })
  assert.deepEqual(result, { ok: true })
  // 草稿 route（无模型、无显式协议）也可添加
  assert.deepEqual(
    addEligibility({
      model: model('deepseek/deepseek-flash', 'openai-completions'),
      provider: providerWith({}),
      apis,
    }),
    { ok: true },
  )
})

test('addEligibility：不可服务 / 重复 / 协议冲突 / 混合 / 无 route 分别被拦', () => {
  const chat = providerWith({ api: 'anthropic-messages' })
  assert.deepEqual(
    addEligibility({
      model: model('google/gemini-3', 'google-generative-ai', false),
      provider: chat,
      apis,
    }),
    { ok: false, reason: 'unsupported', detail: 'google-generative-ai' },
  )
  assert.deepEqual(
    addEligibility({
      model: model('deepseek/deepseek-flash', 'openai-completions'),
      provider: providerWith({
        models: [{ ...emptyModelEntry('deepseek-flash'), extends: 'deepseek/deepseek-flash' }],
      }),
      apis,
    }),
    { ok: false, reason: 'duplicate' },
  )
  assert.deepEqual(
    addEligibility({
      model: model('deepseek/deepseek-flash', 'openai-completions'),
      provider: chat,
      apis,
    }),
    { ok: false, reason: 'protocol-conflict', detail: 'anthropic-messages' },
  )
  assert.deepEqual(
    addEligibility({
      model: model('deepseek/deepseek-flash', 'openai-completions'),
      provider: providerWith({
        models: [
          { ...emptyModelEntry('a'), extends: 'deepseek/deepseek-flash' },
          { ...emptyModelEntry('b'), extends: 'kimi-coding/k3' },
        ],
      }),
      apis,
    }),
    { ok: false, reason: 'route-mixed' },
  )
  assert.deepEqual(
    addEligibility({
      model: model('deepseek/deepseek-flash', 'openai-completions'),
      provider: undefined,
      apis,
    }),
    { ok: false, reason: 'no-route' },
  )
})

/** 最小模型条目草稿（id + 空 extends），供组合补丁用。 */
function emptyModelEntry(id: string) {
  return {
    id,
    extends: '',
    name: '',
    contextWindow: '',
    maxTokens: '',
    input: { text: false, image: false },
    reasoningEfforts: { nonReasoning: false, levels: {} },
    compat: {},
    extra: {},
  }
}
