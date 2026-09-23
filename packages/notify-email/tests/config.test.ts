import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unwrapVolatile } from '@dsh-plus/shared'

import { Config, isDeliverable } from '../src/config.ts'

test('given empty config, when schema resolves, then safe defaults apply (disabled, 465/TLS)', () => {
  const cfg = unwrapVolatile(Config({}))
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.smtp.port, 465)
  assert.equal(cfg.smtp.secure, true)
  assert.equal(cfg.triggers.onComplete, true)
  assert.equal(cfg.triggers.onAborted, false)
  assert.equal(cfg.idleDebounceMs, 3000)
  assert.equal(cfg.dryRun, false)
})

test('given partial config, when schema resolves, then nested defaults fill gaps', () => {
  const cfg = unwrapVolatile(Config({ enabled: true, smtp: { host: 'smtp.example.com' } }))
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.smtp.host, 'smtp.example.com')
  assert.equal(cfg.smtp.port, 465)
  assert.deepEqual(cfg.to, [])
})

test('given deliverability rules, when checked, then enabled+host+from+to all required', () => {
  const base = { enabled: true, smtp: { host: 'h', from: 'f' }, to: ['a@b.c'] }
  assert.equal(isDeliverable(unwrapVolatile(Config(base))), true)
  assert.equal(isDeliverable(unwrapVolatile(Config({ ...base, enabled: false }))), false)
  assert.equal(
    isDeliverable(unwrapVolatile(Config({ ...base, smtp: { host: '', from: 'f' } }))),
    false,
  )
  assert.equal(isDeliverable(unwrapVolatile(Config({ ...base, to: [] }))), false)
})
