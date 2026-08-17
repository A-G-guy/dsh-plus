import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, isDeliverable, toUserPatch, toWire, WirePatch } from '../src/config.ts'

test('given empty config, when schema resolves, then safe defaults apply (disabled, 465/TLS)', () => {
  const cfg = Config({})
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.smtp.port, 465)
  assert.equal(cfg.smtp.secure, true)
  assert.equal(cfg.triggers.onComplete, true)
  assert.equal(cfg.triggers.onAborted, false)
  assert.equal(cfg.idleDebounceMs, 3000)
  assert.equal(cfg.dryRun, false)
})

test('given partial config, when schema resolves, then nested defaults fill gaps', () => {
  const cfg = Config({ enabled: true, smtp: { host: 'smtp.example.com' } })
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.smtp.host, 'smtp.example.com')
  assert.equal(cfg.smtp.port, 465)
  assert.deepEqual(cfg.to, [])
})

test('given config with password, when serialized for the wire, then pass never leaves the host', () => {
  const cfg = Config({ smtp: { pass: 's3cret' } })
  const wire = toWire(cfg, true)
  assert.equal(wire.smtp.passConfigured, true)
  assert.equal(JSON.stringify(wire).includes('s3cret'), false)
})

test('given empty pass in patch, when mapped to user patch, then stored password survives', () => {
  const patch = toUserPatch({ smtp: { host: 'h', pass: '' } })
  assert.deepEqual(patch, { smtp: { host: 'h' } })
})

test('given non-empty pass in patch, when mapped to user patch, then pass is carried', () => {
  const patch = toUserPatch({ smtp: { pass: 'new-secret' } })
  assert.deepEqual(patch, { smtp: { pass: 'new-secret' } })
})

test('given invalid patch field type, when validated at the boundary, then rejected', () => {
  assert.throws(() => WirePatch({ smtp: { port: 'abc' } }))
  assert.throws(() => WirePatch({ maxBodyChars: 50 }))
  assert.doesNotThrow(() => WirePatch({ enabled: true }))
})

test('given deliverability rules, when checked, then enabled+host+from+to all required', () => {
  const base = { enabled: true, smtp: { host: 'h', from: 'f' }, to: ['a@b.c'] }
  assert.equal(isDeliverable(Config(base)), true)
  assert.equal(isDeliverable(Config({ ...base, enabled: false })), false)
  assert.equal(isDeliverable(Config({ ...base, smtp: { host: '', from: 'f' } })), false)
  assert.equal(isDeliverable(Config({ ...base, to: [] })), false)
})
