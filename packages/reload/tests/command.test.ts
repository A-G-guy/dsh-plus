import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runReloadCommand, type CommandDeps } from '../src/command.ts'
import type { PreflightResult } from '../src/preflight.ts'
import { ReloadScheduler } from '../src/scheduler.ts'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const PREFLIGHT_OK: PreflightResult = { ok: true, reasons: [] }
const PREFLIGHT_FAIL: PreflightResult = { ok: false, reasons: ['当前进程非 systemd 托管'] }

function makeDeps(overrides: {
  preflight?: PreflightResult
  running?: number
} = {}) {
  const spawned: string[] = []
  const scheduler = new ReloadScheduler({
    unitName: 'dsh-web',
    confirmTokenTtlMs: 60000,
    serverGraceMs: 10,
    spawnRestart: (unit) => spawned.push(unit),
  })
  const deps: CommandDeps = {
    scheduler,
    preflight: () => Promise.resolve(overrides.preflight ?? PREFLIGHT_OK),
    runningAgents: () => overrides.running ?? 0,
  }
  return { deps, scheduler, spawned }
}

test('given healthy preflight and idle agents, when /reload, then scheduled with cancel hint', async () => {
  const { deps, spawned } = makeDeps()
  const result = await runReloadCommand('', deps)
  assert.equal(result.kind, 'success')
  assert.match(result.text ?? '', /\/reload cancel/)
  await sleep(30)
  assert.deepEqual(spawned, ['dsh-web'])
})

test('given failed preflight, when /reload, then error lists reasons and nothing schedules', async () => {
  const { deps, scheduler, spawned } = makeDeps({ preflight: PREFLIGHT_FAIL })
  const result = await runReloadCommand('', deps)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /非 systemd 托管/)
  assert.equal(scheduler.getState(), 'idle')
  await sleep(30)
  assert.equal(spawned.length, 0)
})

test('given running agents, when /reload, then blocked with force hint', async () => {
  const { deps, spawned } = makeDeps({ running: 3 })
  const result = await runReloadCommand('', deps)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /3 个会话/)
  assert.match(result.text, /\/reload force/)
  await sleep(30)
  assert.equal(spawned.length, 0)
})

test('given running agents, when /reload force, then scheduled anyway', async () => {
  const { deps, spawned } = makeDeps({ running: 3 })
  const result = await runReloadCommand(' force ', deps)
  assert.equal(result.kind, 'success')
  await sleep(30)
  assert.equal(spawned.length, 1)
})

test('given scheduled restart, when /reload cancel, then aborted and spawn never fires', async () => {
  const { deps, spawned } = makeDeps()
  await runReloadCommand('', deps)
  const cancel = await runReloadCommand('cancel', deps)
  assert.equal(cancel.kind, 'success')
  assert.match(cancel.text ?? '', /已取消/)
  await sleep(30)
  assert.equal(spawned.length, 0)
})

test('given no pending flow, when /reload cancel, then reports nothing to cancel', async () => {
  const { deps } = makeDeps()
  const result = await runReloadCommand('cancel', deps)
  assert.equal(result.kind, 'success')
  assert.match(result.text ?? '', /没有/)
})

test('given any state, when /reload status, then reports preflight and scheduler state', async () => {
  const { deps } = makeDeps({ running: 1 })
  const result = await runReloadCommand('status', deps)
  assert.equal(result.kind, 'success')
  assert.match(result.text ?? '', /预检: 通过/)
  assert.match(result.text ?? '', /运行中会话: 1/)
})

test('given failed preflight, when /reload status, then error kind with reasons', async () => {
  const { deps } = makeDeps({ preflight: PREFLIGHT_FAIL })
  const result = await runReloadCommand('status', deps)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /未通过/)
})

test('given unknown argument, when /reload, then usage error', async () => {
  const { deps } = makeDeps()
  const result = await runReloadCommand('explode', deps)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /用法:/)
})
