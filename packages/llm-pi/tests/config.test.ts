import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config } from '../src/config.ts'

test('Config 默认值：不自动拉取 models.dev（catalogRefreshHours=0），无代理', () => {
  const config = Config({})
  assert.equal(config.enabled, true)
  assert.equal(config.catalogUrl, 'https://models.dev/api.json')
  assert.equal(config.catalogRefreshHours, 0)
  assert.equal(config.catalogProxy, '')
  assert.deepEqual(config.providers, {})
})
