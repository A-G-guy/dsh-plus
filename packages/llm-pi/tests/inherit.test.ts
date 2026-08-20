import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ModelsDevSource } from '../src/catalog/models-dev.ts'
import { ExtendsError, parseExtendsRef, resolveModelBase } from '../src/inherit.ts'
import { loadVendoredKit } from '../src/resolve-dsh.ts'

const kit = loadVendoredKit()

/** 带 fixtures 的 models.dev 源：缓存文件即数据源，TTL 内不触网。 */
async function fixtureModelsDev(): Promise<ModelsDevSource> {
  const dir = mkdtempSync(join(tmpdir(), 'llm-pi-test-'))
  const file = join(dir, 'models-dev.json')
  writeFileSync(
    file,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      data: {
        'acme-lab': {
          id: 'acme-lab',
          models: {
            'acme-huge': {
              id: 'acme-huge',
              name: 'Acme Huge',
              reasoning: true,
              limit: { context: 512000, output: 64000 },
            },
          },
        },
      },
    }),
  )
  const source = new ModelsDevSource(file, 'http://127.0.0.1:1/unreachable', 24, () => {})
  await source.ensureLoaded()
  return source
}

test('parseExtendsRef 解析两种形态', () => {
  assert.deepEqual(parseExtendsRef('deepseek/deepseek-v4-flash'), {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
  })
  assert.deepEqual(parseExtendsRef('deepseek-v4-flash'), {
    model: 'deepseek-v4-flash',
  })
  assert.throws(() => parseExtendsRef('/x'), ExtendsError)
  assert.throws(() => parseExtendsRef('a/b/c'), ExtendsError)
})

test('显式 "provider/model" 引用命中内置目录', () => {
  const hit = resolveModelBase(
    'chat',
    {},
    { id: 'flash', extends: 'deepseek/deepseek-v4-flash' },
    kit,
    undefined,
  )
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
    undefined,
  )
  assert.equal(hit.source, 'builtin')
  assert.equal(hit.base.maxTokens, 384000)
})

test('裸 model id 缺 route 级 extends 源时报错', () => {
  assert.throws(
    () => resolveModelBase('chat', {}, { id: 'x', extends: 'deepseek-v4-pro' }, kit, undefined),
    /未配置 provider 级 extends 查找源/,
  )
})

test('内置未收录时回退 models.dev 快照（字段保守）', async () => {
  const modelsDev = await fixtureModelsDev()
  const hit = resolveModelBase(
    'chat',
    {},
    { id: 'h', extends: 'acme-lab/acme-huge' },
    kit,
    modelsDev,
  )
  assert.equal(hit.source, 'models-dev')
  assert.equal(hit.base.contextWindow, 512000)
  assert.equal(hit.base.reasoning, true)
  // 保守原则：不采信模态与 compat
  assert.equal(hit.base.input, undefined)
  assert.equal(hit.base.compat, undefined)
})

test('显式 extends 引用不存在时拒绝并指明引用名', async () => {
  const modelsDev = await fixtureModelsDev()
  assert.throws(
    () =>
      resolveModelBase('chat', {}, { id: 'x', extends: 'deepseek/no-such-model' }, kit, modelsDev),
    /extends 引用 "deepseek\/no-such-model" 在内置目录与 models.dev 快照中都不存在/,
  )
})

test('缺省 extends 且 route 有 extends 源时按同名模型继承；无 extends 源时为手写模型', () => {
  const hit = resolveModelBase(
    'chat',
    { extends: 'deepseek' },
    { id: 'deepseek-v4-flash' },
    kit,
    undefined,
  )
  assert.equal(hit.source, 'builtin')
  const manual = resolveModelBase('chat', {}, { id: 'anything' }, kit, undefined)
  assert.equal(manual.source, 'none')
})
