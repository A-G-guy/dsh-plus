import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config } from '../src/config.ts'

test('given empty config, when schema resolves, then safe defaults apply', () => {
  const cfg = Config({})
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.unitName, 'dsh-web')
  assert.equal(cfg.clientCountdownSeconds, 5)
  assert.equal(cfg.confirmTokenTtlMs, 60000)
  assert.equal(cfg.serverGraceMs, 800)
  assert.equal(cfg.clientPollTimeoutMs, 30000)
})

test('given partial config, when schema resolves, then overrides win and defaults fill gaps', () => {
  const cfg = Config({ enabled: false, unitName: 'dsh-web-dev' })
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.unitName, 'dsh-web-dev')
  assert.equal(cfg.serverGraceMs, 800)
})
