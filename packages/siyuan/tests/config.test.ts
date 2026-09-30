import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, effectiveDeny, type SiyuanConfig } from '../src/config.ts'

/** 以 schema 补默认，得到完整配置（等价加载器行为）。 */
function configWith(overrides: Partial<SiyuanConfig> = {}): SiyuanConfig {
  return { ...Config({}), ...overrides } as SiyuanConfig
}

test('given default config, when resolving the effective deny list, then derived web tools yield to the mounted auxiliary ones', () => {
  const deny = effectiveDeny(configWith())
  assert.deepEqual(
    deny.sort(),
    ['web_fetch', 'web_search'],
    'aux 工具在位且无前缀：派生侧同名 web 工具让位，避免注册期重名竞态',
  )
})

test('given auxTools disabled, when resolving, then the SiYuan-native web tools stay exposed', () => {
  assert.deepEqual(effectiveDeny(configWith({ auxTools: false })), [])
})

test('given a non-empty name prefix, when resolving, then no name collides and nothing is injected', () => {
  assert.deepEqual(effectiveDeny(configWith({ namePrefix: 'sy_' })), [])
})

test('given explicit user deny entries, when resolving, then they merge without duplicates', () => {
  const deny = effectiveDeny(configWith({ deny: ['web_search', 'sync'] }))
  assert.deepEqual([...deny].sort(), ['sync', 'web_fetch', 'web_search'])
})
