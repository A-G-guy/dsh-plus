import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compatFieldsOf,
  compatProtocols,
  compatWithholdFieldsOf,
  mergeCompat,
  validateCompat,
} from '../src/compat.ts'
import { loadVendoredKit } from '../src/resolve-dsh.ts'

// 门控表由套件加载流程从官方副本推导（official-surface.ts）；本文件聚焦校验语义，
// 推导正确性由 official-surface.test.ts 守门。此处显式加载一次以安装推导表。
loadVendoredKit()

test('validateCompat 接受本协议 offer 字段', () => {
  validateCompat('openai-completions', { thinkingFormat: 'deepseek', supportsStore: false }, 'test')
  validateCompat(
    'anthropic-messages',
    { forceAdaptiveThinking: true, allowEmptySignature: true },
    'test',
  )
  validateCompat('openai-responses', { supportsStrictMode: true }, 'test')
  // 缺省/空 compat 合法
  validateCompat('openai-completions', undefined, 'test')
})

test('validateCompat 拒绝未知键并列出可配置字段（对齐官方门控）', () => {
  assert.throws(
    () => validateCompat('openai-completions', { nonExistentSwitch: true }, 'test'),
    /compat\.nonExistentSwitch 不是 openai-completions 协议的合法字段（可配置字段：/,
  )
  // anthropic 字段不能用在 completions 协议上
  assert.throws(
    () => validateCompat('openai-completions', { forceAdaptiveThinking: true }, 'test'),
    /合法字段/,
  )
})

test('validateCompat 拒绝官方 withhold 字段（逐个取自现场推导表，不写死字段名）', () => {
  // 官方会随版本增删 withhold 字段：断言"表里标 withhold 的每一个都被拒"，
  // 而不是钉住某几个可能被官方删掉的字段名（0.2.1-alpha.1 起已无 supportsToolReferences）。
  let checked = 0
  for (const api of compatProtocols()) {
    for (const field of compatWithholdFieldsOf(api)) {
      checked += 1
      assert.throws(
        () => validateCompat(api, { [field]: true }, 'test'),
        /withhold/,
        `${api}.${field} 标为 withhold 却未被拒绝`,
      )
    }
  }
  assert.ok(checked > 0, '现场推导表应至少有一个 withhold 字段')
  // 官方目录已为对应厂商设置的典型项（当前线仍 withhold）在表内
  assert.ok(compatWithholdFieldsOf('openai-completions').includes('openRouterRouting'))
  assert.ok(compatWithholdFieldsOf('anthropic-messages').includes('sendSessionAffinityHeaders'))
})

test('compatProtocols 覆盖运行期协议（官方表可能另有本插件不服务的协议门控）', () => {
  const table = compatProtocols()
  // 官方 0.2.1-alpha.2 的 COMPAT_GATES 含 7 个协议，而 supportedProtocols() 只声明 3 个：
  // 渲染兜底要覆盖"本插件能服务的全部协议"，不要求与官方表逐键相等。
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    assert.ok(table.includes(api), `${api} 应在生效表内`)
  }
  assert.ok(table.length >= 3)
})

test('validateCompat 拒绝错误值类型/枚举与无值键', () => {
  assert.throws(
    () => validateCompat('openai-completions', { supportsStore: 'yes' }, 'test'),
    /必须是布尔值/,
  )
  assert.throws(
    () => validateCompat('openai-completions', { maxTokensField: 'tokens_max' }, 'test'),
    /max_completion_tokens/,
  )
  assert.throws(
    () => validateCompat('openai-completions', { chatTemplateKwargs: ['x'] }, 'test'),
    /必须是对象/,
  )
  // 官方 assertOfferedCompatFields 同款：无值键（写了但没生效）拒绝
  assert.throws(
    () => validateCompat('openai-completions', { supportsStore: undefined }, 'test'),
    /未设置值/,
  )
  assert.throws(
    () => validateCompat('openai-completions', { supportsStore: null }, 'test'),
    /未设置值/,
  )
})

test('validateCompat 拒绝未知协议', () => {
  assert.throws(() => validateCompat('grpc', { x: true }, 'test'), /无 compat 字段表/)
})

test('mergeCompat 逐字段合并，后者覆盖前者，丢弃 undefined/null', () => {
  const merged = mergeCompat(
    { thinkingFormat: 'deepseek', supportsStore: false },
    { supportsStore: true, maxTokensField: undefined },
    { requiresToolResultName: true },
  )
  assert.deepEqual(merged, {
    thinkingFormat: 'deepseek',
    supportsStore: true,
    requiresToolResultName: true,
  })
  assert.equal(mergeCompat(undefined, undefined), undefined)
  assert.equal(mergeCompat({ a: undefined, b: null }), undefined)
})

test('compatFieldsOf 只列官方 offer 字段（对齐 catalog.ts COMPAT_GATES）', () => {
  // 官方门控 offer 计数：completions 19 / responses 4 / anthropic 7
  // （逐字段一致性由 official-surface.test.ts 直读官方 bundle 守门）
  assert.equal(compatFieldsOf('openai-completions').length, 19)
  assert.equal(compatFieldsOf('openai-responses').length, 4)
  assert.equal(compatFieldsOf('anthropic-messages').length, 7)
  // withhold 字段不在 offer 列表
  assert.ok(!compatFieldsOf('openai-completions').includes('zaiToolStream'))
  assert.ok(!compatFieldsOf('openai-completions').includes('openRouterRouting'))
  assert.ok(!compatFieldsOf('anthropic-messages').includes('supportsToolReferences'))
  assert.ok(!compatFieldsOf('anthropic-messages').includes('supportsMidConvoEffort'))
  assert.ok(!compatFieldsOf('anthropic-messages').includes('allowedFallbackModels'))
  // 官方新增 offer：chatTemplateArgs / supportsThinkingTokenBudget / supportsFinishReason
  assert.ok(compatFieldsOf('openai-completions').includes('chatTemplateArgs'))
  assert.ok(compatFieldsOf('openai-completions').includes('supportsThinkingTokenBudget'))
  assert.ok(compatFieldsOf('openai-completions').includes('supportsFinishReason'))
})

test('官方新增 offer 字段自动可用（手抄旧表漏收会误拒）', () => {
  // completions：vLLM 思考预算字段名与端点优先级
  validateCompat(
    'openai-completions',
    { thinkingTokenBudgetField: 'thinking_budget_tokens', vllmPriority: 3 },
    'test',
  )
  // responses：输出上限开关
  validateCompat('openai-responses', { supportsMaxOutputTokens: true }, 'test')
  // 枚举/整数取值约束（官方 THINKING_TOKEN_BUDGET_FIELDS / z.number().step(1)）
  assert.throws(
    () => validateCompat('openai-completions', { thinkingTokenBudgetField: 'budget' }, 'test'),
    /thinking_token_budget/,
  )
  assert.throws(
    () => validateCompat('openai-completions', { vllmPriority: 1.5 }, 'test'),
    /必须是整数/,
  )
  assert.throws(
    () => validateCompat('openai-completions', { vllmPriority: 'high' }, 'test'),
    /必须是整数/,
  )
})

test('官方 withhold 新增字段写时拒绝（目录已为厂商设置）', () => {
  assert.throws(
    () => validateCompat('anthropic-messages', { supportsMidConvoEffort: true }, 'test'),
    /withhold/,
  )
  assert.throws(
    () => validateCompat('anthropic-messages', { allowedFallbackModels: [] }, 'test'),
    /withhold/,
  )
})
