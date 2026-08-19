import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ReloadScheduler } from '../src/scheduler.ts'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function makeScheduler(overrides: {
  ttlMs?: number
  graceMs?: number
  now?: () => number
} = {}) {
  const spawned: string[] = []
  const scheduler = new ReloadScheduler({
    unitName: 'dsh-web',
    confirmTokenTtlMs: overrides.ttlMs ?? 60000,
    serverGraceMs: overrides.graceMs ?? 10,
    spawnRestart: (unit) => spawned.push(unit),
    now: overrides.now,
  })
  return { scheduler, spawned }
}

test('given prepared token, when confirm with no running agents, then schedules and spawns after grace', async () => {
  const { scheduler, spawned } = makeScheduler()
  const { token } = scheduler.prepare()
  const result = scheduler.confirm(token, { force: false, runningAgents: 0 })
  assert.deepEqual(result, { kind: 'scheduled', etaMs: 10 })
  assert.equal(scheduler.getState(), 'scheduled')
  await sleep(30)
  assert.deepEqual(spawned, ['dsh-web'])
})

test('given running agents without force, when confirm, then rejected and token survives for force retry', async () => {
  const { scheduler, spawned } = makeScheduler()
  const { token } = scheduler.prepare()
  const blocked = scheduler.confirm(token, { force: false, runningAgents: 2 })
  assert.deepEqual(blocked, { kind: 'agents-running', count: 2 })
  assert.equal(scheduler.getState(), 'prepared')
  const forced = scheduler.confirm(token, { force: true, runningAgents: 2 })
  assert.equal(forced.kind, 'scheduled')
  await sleep(30)
  assert.equal(spawned.length, 1)
})

test('given wrong or reused token, when confirm, then invalid-token and nothing spawns', async () => {
  const { scheduler, spawned } = makeScheduler()
  scheduler.prepare()
  assert.equal(scheduler.confirm('nope', { force: false, runningAgents: 0 }).kind, 'invalid-token')
  await sleep(30)
  assert.equal(spawned.length, 0)
})

test('given expired token, when confirm, then invalid-token and state resets', () => {
  let now = 1000
  const { scheduler } = makeScheduler({ ttlMs: 100, now: () => now })
  const { token } = scheduler.prepare()
  now += 200
  assert.equal(scheduler.confirm(token, { force: false, runningAgents: 0 }).kind, 'invalid-token')
  assert.equal(scheduler.getState(), 'idle')
})

test('given scheduled restart, when confirm again with same token, then idempotent without extra spawn', async () => {
  const { scheduler, spawned } = makeScheduler()
  const { token } = scheduler.prepare()
  scheduler.confirm(token, { force: false, runningAgents: 0 })
  const again = scheduler.confirm(token, { force: false, runningAgents: 0 })
  assert.equal(again.kind, 'scheduled')
  await sleep(30)
  assert.equal(spawned.length, 1)
})

test('given scheduled restart, when cancel with token inside grace, then spawn never fires', async () => {
  const { scheduler, spawned } = makeScheduler({ graceMs: 50 })
  const { token } = scheduler.prepare()
  scheduler.confirm(token, { force: false, runningAgents: 0 })
  assert.equal(scheduler.cancel(token), true)
  assert.equal(scheduler.getState(), 'idle')
  await sleep(70)
  assert.equal(spawned.length, 0)
})

test('given prepared flow, when cancel with wrong token, then flow untouched', () => {
  const { scheduler } = makeScheduler()
  scheduler.prepare()
  assert.equal(scheduler.cancel('nope'), false)
  assert.equal(scheduler.getState(), 'prepared')
})

test('given re-prepare, when old token confirmed, then invalidated', () => {
  const { scheduler } = makeScheduler()
  const first = scheduler.prepare()
  scheduler.prepare()
  assert.equal(scheduler.confirm(first.token, { force: false, runningAgents: 0 }).kind, 'invalid-token')
})

test('given active flow, when abort from local command plane, then state resets without token', () => {
  const { scheduler } = makeScheduler()
  scheduler.prepare()
  assert.equal(scheduler.abort(), true)
  assert.equal(scheduler.getState(), 'idle')
  assert.equal(scheduler.abort(), false)
})

test('given two schedulers, when constructed, then bootIds differ', () => {
  const a = makeScheduler()
  const b = makeScheduler()
  assert.notEqual(a.scheduler.bootId, b.scheduler.bootId)
})
