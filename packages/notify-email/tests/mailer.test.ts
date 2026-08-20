import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, type NotifyEmailConfig } from '../src/config.ts'
import { Mailer } from '../src/mailer.ts'

function cfgOf(overrides: Record<string, unknown>): NotifyEmailConfig {
  return Config({
    enabled: true,
    smtp: { host: 'smtp.example.com', from: 'me@example.com' },
    to: ['you@example.com'],
    ...overrides,
  })
}

function fakeTransport(log: { cfg: NotifyEmailConfig; subject: string }[], failWith?: string) {
  return async (cfg: NotifyEmailConfig, msg: { subject: string }): Promise<void> => {
    if (failWith !== undefined) throw new Error(failWith)
    log.push({ cfg, subject: msg.subject })
  }
}

const silentLogger = { info() {}, warn() {} }
const MSG = { subject: 's', text: 't' }

test('given disabled config, when sending a notice, then skipped before touching transport', async () => {
  const sent: { cfg: NotifyEmailConfig; subject: string }[] = []
  const mailer = new Mailer(() => cfgOf({ enabled: false }), silentLogger, fakeTransport(sent))
  const result = await mailer.send(MSG)
  assert.deepEqual(result, { ok: false, detail: 'disabled' })
  assert.equal(sent.length, 0)
})

test('given complete config, when sending, then transport receives resolved config and message', async () => {
  const sent: { cfg: NotifyEmailConfig; subject: string }[] = []
  const mailer = new Mailer(() => cfgOf({}), silentLogger, fakeTransport(sent))
  const result = await mailer.send(MSG)
  assert.deepEqual(result, { ok: true, detail: 'sent' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.cfg.smtp.host, 'smtp.example.com')
  assert.equal(sent[0]?.subject, 's')
})

test('given dry-run config, when sending, then transport untouched and logged', async () => {
  const sent: { cfg: NotifyEmailConfig; subject: string }[] = []
  const infos: string[] = []
  const logger = { info: (m: string) => infos.push(m), warn() {} }
  const mailer = new Mailer(() => cfgOf({ dryRun: true }), logger, fakeTransport(sent))
  const result = await mailer.send(MSG)
  assert.deepEqual(result, { ok: true, detail: 'dry-run' })
  assert.equal(sent.length, 0)
  assert.equal(infos.length, 1)
})

test('given smtp failure, when sending, then failure is contained with context log', async () => {
  const warns: string[] = []
  const logger = { info() {}, warn: (m: string) => warns.push(m) }
  const mailer = new Mailer(() => cfgOf({}), logger, fakeTransport([], 'SMTP 535 auth failed'))
  const result = await mailer.send(MSG)
  assert.equal(result.ok, false)
  assert.match(result.detail, /535/)
  assert.equal(warns.length, 1)
  assert.match(warns[0] ?? '', /535/)
})

test('given disabled config, when forced (test email), then enabled gate is bypassed', async () => {
  const sent: { cfg: NotifyEmailConfig; subject: string }[] = []
  const mailer = new Mailer(() => cfgOf({ enabled: false }), silentLogger, fakeTransport(sent))
  const result = await mailer.send(MSG, true)
  assert.deepEqual(result, { ok: true, detail: 'sent' })
  assert.equal(sent.length, 1)
})

test('given incomplete smtp, when sending, then reported incomplete without transport', async () => {
  const sent: { cfg: NotifyEmailConfig; subject: string }[] = []
  const mailer = new Mailer(() => cfgOf({ to: [] }), silentLogger, fakeTransport(sent))
  const result = await mailer.send(MSG)
  assert.deepEqual(result, { ok: false, detail: 'incomplete' })
  assert.equal(sent.length, 0)
})
