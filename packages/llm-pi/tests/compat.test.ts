import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compatFieldsOf, mergeCompat, validateCompat } from '../src/compat.ts'

test('validateCompat 接受本协议合法字段', () => {
  validateCompat('openai-completions', { thinkingFormat: 'deepseek', supportsStore: false }, 'test')
  validateCompat(
    'anthropic-messages',
    { forceAdaptiveThinking: true, allowEmptySignature: true },
    'test',
  )
  validateCompat('openai-responses', { supportsToolSearch: true }, 'test')
  // undefined 视为未设置，跳过
  validateCompat('openai-completions', { supportsStore: undefined }, 'test')
  // 空/缺省 compat 合法
  validateCompat('openai-completions', undefined, 'test')
})

test('validateCompat 拒绝未知键并列出合法字段（对比官方静默丢弃）', () => {
  assert.throws(
    () => validateCompat('openai-completions', { nonExistentSwitch: true }, 'test'),
    /compat\.nonExistentSwitch 不是 openai-completions 协议的合法字段/,
  )
  // anthropic 字段不能用在 completions 协议上
  assert.throws(
    () => validateCompat('openai-completions', { forceAdaptiveThinking: true }, 'test'),
    /合法字段/,
  )
})

test('validateCompat 拒绝错误值类型/枚举', () => {
  assert.throws(
    () => validateCompat('openai-completions', { supportsStore: 'yes' }, 'test'),
    /必须是布尔值/,
  )
  assert.throws(
    () => validateCompat('openai-completions', { maxTokensField: 'tokens_max' }, 'test'),
    /max_completion_tokens/,
  )
  assert.throws(
    () => validateCompat('openai-completions', { openRouterRouting: ['x'] }, 'test'),
    /必须是对象/,
  )
})

test('validateCompat 拒绝未知协议', () => {
  assert.throws(() => validateCompat('grpc', { x: true }, 'test'), /无 compat 字段表/)
})

test('mergeCompat 逐字段合并，后者覆盖前者，丢弃 undefined', () => {
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
  assert.equal(mergeCompat({ a: undefined }), undefined)
})

test('compatFieldsOf 覆盖三协议字段全集', () => {
  assert.equal(compatFieldsOf('openai-completions').length, 21)
  assert.equal(compatFieldsOf('openai-responses').length, 7)
  assert.equal(compatFieldsOf('anthropic-messages').length, 9)
})
