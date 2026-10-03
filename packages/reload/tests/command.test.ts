import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type CommandDeps, runReloadCommand } from '../src/command.ts'
import type { PreflightResult } from '../src/preflight.ts'
import type { ApplyReport } from '../src/report.ts'
import { ReloadScheduler } from '../src/scheduler.ts'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const PREFLIGHT_OK: PreflightResult = { ok: true, reasons: [] }
const PREFLIGHT_FAIL: PreflightResult = {
  ok: false,
  reasons: ['当前进程非 systemd 托管'],
}
const APPLIED: ApplyReport = {
  status: 'applied',
  text: '已即时生效：profile 组合层已重新对账。',
  warnings: [],
  pendingRestart: [],
  capabilities: { profile: true, hmr: true, pluginPackages: true },
  runningAgents: 0,
}

interface Options {
  preflight?: PreflightResult
  running?: number
  report?: ApplyReport
  status?: string
}

function makeDeps(options: Options = {}) {
  const spawned: string[] = []
  const applied: boolean[] = []
  const scheduler = new ReloadScheduler({
    unitName: 'dsh-web',
    confirmTokenTtlMs: 60000,
    serverGraceMs: 10,
    spawnRestart: (unit) => spawned.push(unit),
  })
  const deps: CommandDeps = {
    apply: (applyOptions) => {
      applied.push(applyOptions.force)
      return Promise.resolve(options.report ?? APPLIED)
    },
    status: () => Promise.resolve(options.status ?? '进程内重载: 可用'),
    scheduler,
    preflight: () => Promise.resolve(options.preflight ?? PREFLIGHT_OK),
    runningAgents: () => options.running ?? 0,
  }
  return { deps, applied, scheduler, spawned }
}

test('given a clean apply, when /reload, then the report text renders as success', async () => {
  const { deps, applied } = makeDeps()
  const result = await runReloadCommand('', deps)
  assert.equal(result.kind, 'success')
  assert.match(result.text ?? '', /已即时生效/)
  assert.deepEqual(applied, [false])
})

test('given /reload force, when run, then force is forwarded', async () => {
  const { deps, applied } = makeDeps()
  await runReloadCommand(' force ', deps)
  assert.deepEqual(applied, [true])
})

test('given a blocked apply, when /reload, then error carries the report text', async () => {
  const { deps } = makeDeps({
    report: { ...APPLIED, status: 'agents-running', text: '检测到 1 个会话正在运行。' },
  })
  const result = await runReloadCommand('', deps)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /1 个会话正在运行/)
})

test('given healthy preflight, when /reload restart, then scheduled with cancel hint', async () => {
  const { deps, spawned } = makeDeps()
  const result = await runReloadCommand('restart', deps)
  assert.equal(result.kind, 'success')
  assert.match(result.text ?? '', /\/reload cancel/)
  await sleep(30)
  assert.deepEqual(spawned, ['dsh-web'])
})

test('given failed preflight, when /reload restart, then error lists reasons and nothing schedules', async () => {
  const { deps, scheduler, spawned } = makeDeps({ preflight: PREFLIGHT_FAIL })
  const result = await runReloadCommand('restart', deps)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /非 systemd 托管/)
  assert.equal(scheduler.getState(), 'idle')
  await sleep(30)
  assert.equal(spawned.length, 0)
})

test('given running agents, when /reload restart, then blocked with force hint', async () => {
  const { deps, spawned } = makeDeps({ running: 3 })
  const result = await runReloadCommand('restart', deps)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /3 个会话/)
  assert.match(result.text, /\/reload restart force/)
  await sleep(30)
  assert.equal(spawned.length, 0)
})

test('given running agents, when /reload restart force, then scheduled anyway', async () => {
  const { deps, spawned } = makeDeps({ running: 3 })
  const result = await runReloadCommand('restart force', deps)
  assert.equal(result.kind, 'success')
  await sleep(30)
  assert.equal(spawned.length, 1)
})

test('given a scheduled restart, when /reload cancel, then aborted and spawn never fires', async () => {
  const { deps, spawned } = makeDeps()
  await runReloadCommand('restart', deps)
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

test('given any state, when /reload status, then the status text renders as success', async () => {
  const { deps } = makeDeps({ status: '进程内重载: 可用（profile ✓ / hmr ✓ / pluginPackages ✓）' })
  const result = await runReloadCommand('status', deps)
  assert.equal(result.kind, 'success')
  assert.match(result.text ?? '', /pluginPackages ✓/)
})

test('given unknown argument, when /reload, then usage error', async () => {
  const { deps } = makeDeps()
  const result = await runReloadCommand('explode', deps)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /用法:/)
})
