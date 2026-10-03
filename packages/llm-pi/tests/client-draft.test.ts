/**
 * 卡片草稿的 extra（表单未覆盖字段）往返测试：
 * 未知字段必须原样保留，否则保存会静默丢掉 deepseek 等高级项。
 * （draft.ts 不含 JSX/React，node --test 可直接导入。）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { draftFromValue, extraOfJson, toPatch } from '../src/client/draft.ts'

test('给定含未知字段的 provider，当折算草稿时，则未知字段进入 extra 而非被丢弃', () => {
  const value = {
    enabled: true,
    catalogUrl: 'https://models.dev/api.json',
    catalogRefreshHours: 0,
    catalogProxy: '',
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
    catalogUrl: 'https://models.dev/api.json',
    catalogRefreshHours: 0,
    catalogProxy: '',
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
