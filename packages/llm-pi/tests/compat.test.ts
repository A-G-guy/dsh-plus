import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compatFieldsOf, mergeCompat, validateCompat } from '../src/compat.ts'

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

test('validateCompat 拒绝官方 withhold 字段（官方目录已为对应厂商设置）', () => {
  // 旧版可配、0.1.2-alpha.1 官方 catalog.ts COMPAT_GATES 标记 withhold 的字段
  assert.throws(
    () => validateCompat('openai-completions', { openRouterRouting: { x: 1 } }, 'test'),
    /withhold/,
  )
  assert.throws(
    () => validateCompat('openai-completions', { zaiToolStream: false }, 'test'),
    /withhold/,
  )
  assert.throws(
    () => validateCompat('openai-responses', { supportsToolSearch: true }, 'test'),
    /withhold/,
  )
  assert.throws(
    () => validateCompat('anthropic-messages', { supportsToolReferences: true }, 'test'),
    /withhold/,
  )
  assert.throws(
    () => validateCompat('anthropic-messages', { sendSessionAffinityHeaders: true }, 'test'),
    /withhold/,
  )
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
  // 官方门控 offer 计数：completions 17 / responses 3 / anthropic 7
  assert.equal(compatFieldsOf('openai-completions').length, 17)
  assert.equal(compatFieldsOf('openai-responses').length, 3)
  assert.equal(compatFieldsOf('anthropic-messages').length, 7)
  // withhold 字段不在 offer 列表
  assert.ok(!compatFieldsOf('openai-completions').includes('zaiToolStream'))
  assert.ok(!compatFieldsOf('openai-completions').includes('openRouterRouting'))
  assert.ok(!compatFieldsOf('anthropic-messages').includes('supportsToolReferences'))
  // 官方新增 offer：chatTemplateArgs / supportsThinkingTokenBudget / supportsFinishReason
  assert.ok(compatFieldsOf('openai-completions').includes('chatTemplateArgs'))
  assert.ok(compatFieldsOf('openai-completions').includes('supportsThinkingTokenBudget'))
  assert.ok(compatFieldsOf('openai-completions').includes('supportsFinishReason'))
})
