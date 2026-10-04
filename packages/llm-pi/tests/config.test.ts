import assert from 'node:assert/strict'
import { test } from 'node:test'

import { unwrapVolatile } from '@dsh-plus/shared'

import { Config, FALLBACK_PROTOCOLS } from '../src/config.ts'

test('Config 默认值：根字段只有 enabled 与 providers（模型目录唯一来自 pi-ai，无目录端点字段）', () => {
  const config = unwrapVolatile(Config({}))
  assert.equal(config.enabled, true)
  assert.deepEqual(config.providers, {})
  assert.deepEqual(Object.keys(config).sort(), ['enabled', 'providers'])
})

test('api 不再由 schema 钉死枚举（合法集合运行期推导），任意字符串可过 schema 层', () => {
  const config = unwrapVolatile(
    Config({ providers: { g: { api: 'some-future-protocol', models: [{ id: 'm' }] } } }),
  )
  assert.equal(config.providers['g']?.api, 'some-future-protocol')
  // 兜底三元组仍在（协议推导失败时的回退集合）
  assert.deepEqual(
    [...FALLBACK_PROTOCOLS],
    ['openai-completions', 'openai-responses', 'anthropic-messages'],
  )
})
