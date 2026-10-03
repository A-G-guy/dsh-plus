import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { InProcessCapabilities, InProcessOutcome } from '../src/inprocess.ts'
import { type ApplyDeps, applyReport, statusText } from '../src/report.ts'

const CAPS_OK: InProcessCapabilities = { profile: true, hmr: true, pluginPackages: true }
const CAPS_NO_PROFILE: InProcessCapabilities = { profile: false, hmr: false, pluginPackages: false }

interface Options {
  capabilities?: InProcessCapabilities
  outcome?: InProcessOutcome
  pending?: string[]
  running?: number
  preflightOk?: boolean
}

function makeDeps(options: Options = {}) {
  const calls: string[] = []
  const deps: ApplyDeps = {
    capabilities: () => options.capabilities ?? CAPS_OK,
    run: () => {
      calls.push('run')
      return Promise.resolve(options.outcome ?? { kind: 'applied', warnings: [] })
    },
    pendingRestart: () => Promise.resolve(options.pending ?? []),
    runningAgents: () => options.running ?? 0,
  }
  return { deps, calls }
}

test('given a clean apply, when reported, then applied without restart changes', async () => {
  const { deps } = makeDeps()
  const report = await applyReport(deps, { force: false })
  assert.equal(report.status, 'applied')
  assert.match(report.text, /已即时生效/)
  assert.match(report.text, /没有检测到需要重启的变更/)
  assert.deepEqual(report.pendingRestart, [])
})

test('given replaced packages, when reported, then they are named with the restart hint', async () => {
  const { deps } = makeDeps({ pending: ['@dsh-plus/reload', '@dsh-plus/web-files'] })
  const report = await applyReport(deps, { force: false })
  assert.equal(report.status, 'applied')
  assert.deepEqual(report.pendingRestart, ['@dsh-plus/reload', '@dsh-plus/web-files'])
  assert.match(report.text, /- @dsh-plus\/reload/)
  assert.match(report.text, /- @dsh-plus\/web-files/)
  assert.match(report.text, /\/reload restart/)
})

test('given inactive diagnostics, when reported, then they render as a diagnosis block', async () => {
  const { deps } = makeDeps({
    outcome: {
      kind: 'applied',
      warnings: ['inactive: dsh-plus-x（waiting for service: webServer）'],
    },
  })
  const report = await applyReport(deps, { force: false })
  assert.deepEqual(report.warnings, ['inactive: dsh-plus-x（waiting for service: webServer）'])
  assert.match(report.text, /诊断：/)
  assert.match(report.text, /- inactive: dsh-plus-x/)
})

test('given running sessions, when not forced, then blocked before running anything', async () => {
  const { deps, calls } = makeDeps({ running: 2 })
  const report = await applyReport(deps, { force: false })
  assert.equal(report.status, 'agents-running')
  assert.equal(report.runningAgents, 2)
  assert.match(report.text, /2 个会话正在运行/)
  assert.match(report.text, /\/reload force/)
  assert.deepEqual(calls, [])
})

test('given running sessions, when forced, then the apply runs', async () => {
  const { deps, calls } = makeDeps({ running: 2 })
  const report = await applyReport(deps, { force: true })
  assert.equal(report.status, 'applied')
  assert.deepEqual(calls, ['run'])
})

test('given no profile context, when reported, then unsupported without running anything', async () => {
  const { deps, calls } = makeDeps({ capabilities: CAPS_NO_PROFILE })
  const report = await applyReport(deps, { force: true })
  assert.equal(report.status, 'unsupported')
  assert.match(report.text, /不支持进程内重载/)
  assert.match(report.text, /没有 profile 上下文/)
  assert.deepEqual(calls, [])
})

test('given the core reports unsupported, when reported, then its reasons are kept', async () => {
  const { deps } = makeDeps({
    outcome: { kind: 'unsupported', reasons: ['运行时缺 hmr 队列'] },
  })
  const report = await applyReport(deps, { force: false })
  assert.equal(report.status, 'unsupported')
  assert.match(report.text, /- 运行时缺 hmr 队列/)
})

test('given the core reports failure, when reported, then message and recovery hints render', async () => {
  const { deps } = makeDeps({
    outcome: { kind: 'failed', message: 'dsh: 新增条目 dsh-plus-bad 未激活' },
  })
  const report = await applyReport(deps, { force: false })
  assert.equal(report.status, 'failed')
  assert.match(report.text, /重载失败：dsh: 新增条目 dsh-plus-bad 未激活/)
  assert.match(report.text, /\/reload restart/)
})

test('given capabilities and pending changes, when status, then all facts are listed', async () => {
  const text = await statusText({
    capabilities: () => CAPS_OK,
    pendingRestart: () => Promise.resolve(['@dsh-plus/reload']),
    runningAgents: () => 0,
    preflight: () => Promise.resolve({ ok: false, reasons: ['sudo 免密校验失败'] }),
    schedulerState: () => 'idle',
    bootId: 'boot-1',
  })
  assert.match(text, /进程内重载: 可用（profile ✓ \/ hmr ✓ \/ pluginPackages ✓）/)
  assert.match(text, /重启通道: 预检未通过/)
  assert.match(text, /- sudo 免密校验失败/)
  assert.match(text, /调度状态: idle；运行中会话: 0；bootId: boot-1/)
  assert.match(text, /待重启生效: @dsh-plus\/reload/)
})

test('given nothing pending and a blocked capability, when status, then reasons and 无 render', async () => {
  const text = await statusText({
    capabilities: () => CAPS_NO_PROFILE,
    pendingRestart: () => Promise.resolve([]),
    runningAgents: () => 0,
    preflight: () => Promise.resolve({ ok: true, reasons: [] }),
    schedulerState: () => 'prepared',
    bootId: 'boot-2',
  })
  assert.match(text, /进程内重载: 不可用/)
  assert.match(text, /- 当前进程没有 profile 上下文/)
  assert.match(text, /重启通道: 预检通过/)
  assert.match(text, /调度状态: prepared/)
  assert.match(text, /待重启生效: 无/)
})
