/**
 * 卡片草稿往返测试：未知字段（表单未覆盖的 wire 字段）必须原样保留，
 * 否则保存会静默丢掉 deepseek 等高级项；根字段收窄为 enabled 后不得再写出目录端点键。
 * （draft.ts 不含 JSX/React，node --test 可直接导入。）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addModelEntry, draftFromValue, extraOfJson, toPatch } from '../src/client/draft.ts'

test('给定含未知字段的 provider，当折算草稿时，则未知字段进入 extra 而非被丢弃', () => {
  const value = {
    enabled: true,
    providers: {
      route1: {
        adapter: 'deepseek',
        baseURL: 'https://api.example.com',
        thinking: 'enabled',
        filesApiTimeoutMs: 60000,
        models: [{ id: 'm1', imagePixelBudget: 4096 }],
      },
    },
  }
  const draft = draftFromValue(value)
  const provider = draft.providers.route1
  assert.deepEqual(provider?.extra, {
    adapter: 'deepseek',
    thinking: 'enabled',
    filesApiTimeoutMs: 60000,
  })
  assert.deepEqual(provider?.models[0]?.extra, { imagePixelBudget: 4096 })
})

test('给定草稿，当折算提交形状时，则 extra 与表单字段一并写出（表单字段优先）', () => {
  const value = {
    enabled: true,
    providers: {
      route1: {
        baseURL: 'https://old.example.com',
        thinking: 'disabled',
        models: [],
      },
    },
  }
  const draft = draftFromValue(value)
  const provider = draft.providers.route1
  assert.ok(provider !== undefined)
  provider.baseURL = 'https://new.example.com'
  const patch = toPatch(draft)
  const out = patch.providers.route1 as Record<string, unknown>
  assert.equal(out.baseURL, 'https://new.example.com')
  assert.equal(out.thinking, 'disabled')
})

test('提交形状只有 enabled 与 providers（目录端点键不再写出）', () => {
  const patch = toPatch(draftFromValue({ enabled: false, providers: {} }))
  assert.deepEqual(Object.keys(patch).sort(), ['enabled', 'providers'])
  assert.equal(patch.enabled, false)
})

test('给定 JSON 文本框值，当折算 extra 时，则空文本清空、非对象忽略、对象浅拷贝', () => {
  assert.deepEqual(extraOfJson(undefined), {})
  assert.equal(extraOfJson(['a']), undefined)
  assert.equal(extraOfJson('text'), undefined)
  assert.equal(extraOfJson(null), undefined)
  const source = { thinking: 'enabled' }
  const copied = extraOfJson(source)
  assert.deepEqual(copied, source)
  assert.notEqual(copied, source)
})

test('目录一键添加只写 id 与 extends（继承跟随目录，不预填容量）', () => {
  const draft = draftFromValue({ enabled: true, providers: { chat: { models: [] } } })
  const result = addModelEntry(draft, 'chat', {
    id: 'deepseek-flash',
    path: 'deepseek/deepseek-flash',
  })
  assert.equal(result.added, true)
  const models = result.draft.providers['chat']?.models ?? []
  assert.equal(models.length, 1)
  assert.equal(models[0]?.id, 'deepseek-flash')
  assert.equal(models[0]?.extends, 'deepseek/deepseek-flash')
  assert.equal(models[0]?.contextWindow, '')
  assert.equal(models[0]?.maxTokens, '')
  assert.equal(models[0]?.name, '')
})

test('同 id 已存在时一键添加不改草稿（added=false，草稿对象同一）', () => {
  const draft = draftFromValue({
    enabled: true,
    providers: { chat: { models: [{ id: 'deepseek-flash', extends: 'deepseek/deepseek-flash' }] } },
  })
  const result = addModelEntry(draft, 'chat', {
    id: 'deepseek-flash',
    path: 'deepseek/deepseek-flash',
  })
  assert.equal(result.added, false)
  assert.equal(result.draft, draft)
})

test('目标 route 不存在时一键添加不改草稿', () => {
  const draft = draftFromValue({ enabled: true, providers: {} })
  const result = addModelEntry(draft, 'missing', { id: 'x', path: 'p/x' })
  assert.equal(result.added, false)
  assert.equal(result.draft, draft)
})
