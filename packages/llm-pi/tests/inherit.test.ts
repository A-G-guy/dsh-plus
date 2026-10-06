/**
 * extends 继承解析：唯一数据源是 pi-ai 内置目录（models.dev 兜底已移除）。
 * 覆盖引用语法、命中/未命中行为与"手写条目"退化。
 * @module @dsh-plus/llm-pi/tests/inherit
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ExtendsError, parseExtendsRef, resolveModelBase } from '../src/inherit.ts'
import { loadVendoredKit } from '../src/resolve-dsh.ts'

const kit = loadVendoredKit()

test('parseExtendsRef 解析两种形态', () => {
  assert.deepEqual(parseExtendsRef('deepseek/deepseek-flash'), {
    provider: 'deepseek',
    model: 'deepseek-flash',
  })
  assert.deepEqual(parseExtendsRef('deepseek-flash'), {
    model: 'deepseek-flash',
  })
  assert.throws(() => parseExtendsRef('/x'), ExtendsError)
  assert.throws(() => parseExtendsRef('a/b/c'), ExtendsError)
})

test('显式 "provider/model" 引用命中内置目录', () => {
  const hit = resolveModelBase('chat', {}, { id: 'flash', extends: 'deepseek/deepseek-flash' }, kit)
  assert.equal(hit.source, 'builtin')
  assert.equal(hit.base.api, 'openai-completions')
  assert.equal(hit.base.contextWindow, 1000000)
  assert.equal((hit.base.compat as Record<string, unknown>)['thinkingFormat'], 'deepseek')
})

test('裸 model id 随 route 级 extends 源查找', () => {
  const hit = resolveModelBase(
    'chat',
    { extends: 'deepseek' },
    { id: 'x', extends: 'deepseek-v4-pro' },
    kit,
  )
  assert.equal(hit.source, 'builtin')
  assert.equal(hit.base.maxTokens, 384000)
})

test('裸 model id 缺 route 级 extends 源时报错', () => {
  assert.throws(
    () => resolveModelBase('chat', {}, { id: 'x', extends: 'deepseek-v4-pro' }, kit),
    /未配置 provider 级 extends 查找源/,
  )
})

test('显式 extends 引用不存在时拒绝，并指明引用名与生效 pi-ai 版本', () => {
  assert.throws(
    () => resolveModelBase('chat', {}, { id: 'x', extends: 'deepseek/no-such-model' }, kit),
    (error: Error) =>
      /extends 引用 "deepseek\/no-such-model" 不在 pi-ai .* 的内置目录中/.test(error.message),
  )
  // 未收录的 provider 与未收录的模型同样拒绝（不存在第二级兜底目录）
  assert.throws(
    () => resolveModelBase('chat', {}, { id: 'x', extends: 'acme-lab/acme-huge' }, kit),
    /acme-lab\/acme-huge/,
  )
})

test('缺省 extends 且 route 有 extends 源时按同名模型继承；无 extends 源时为手写模型', () => {
  const hit = resolveModelBase('chat', { extends: 'deepseek' }, { id: 'deepseek-flash' }, kit)
  assert.equal(hit.source, 'builtin')
  const manual = resolveModelBase('chat', {}, { id: 'anything' }, kit)
  assert.equal(manual.source, 'none')
  assert.deepEqual(manual.base, {})
})

test('继承 base 带上目录给出的可继承字段（extra 透传）', () => {
  const hit = resolveModelBase('chat', {}, { id: 'flash', extends: 'deepseek/deepseek-flash' }, kit)
  // 0.87.1 目录的 deepseek-flash 带 cost/inputLimits：官方模型条目 schema 不接受，
  // 故不进 extra；这里断言的是"不会把目录字段误塞进条目"。
  assert.equal(hit.base.extra, undefined)
  assert.equal(hit.base.name, 'DeepSeek V4.1 Flash')
  assert.deepEqual(hit.base.input, ['text', 'image'])
})
