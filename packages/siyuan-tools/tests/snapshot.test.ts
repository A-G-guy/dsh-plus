import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CapabilityEntry } from '@dsh-plus/siyuan'
import { SNAPSHOT_MEMO } from '@dsh-plus/siyuan'

import { Config, type SiyuanToolsConfig } from '../src/config.ts'
import { createSnapshotGuard, needsSnapshot, type SnapshotDeps } from '../src/snapshot.ts'

function configWith(overrides: Partial<SiyuanToolsConfig> = {}): SiyuanToolsConfig {
  return { ...Config({}), ...overrides } as SiyuanToolsConfig
}

function entry(name: string): CapabilityEntry {
  return {
    name,
    description: `${name} operations`,
    source: 'mcp',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }
}

/** 快照执行替身：记录调用、可注入失败。 */
function fakeDeps(options?: { fail?: string }): SnapshotDeps & { calls: string[]; logs: string[] } {
  const calls: string[] = []
  const logs: string[] = []
  return {
    calls,
    logs,
    async snapshot(memo) {
      calls.push(memo)
      if (options?.fail !== undefined) throw new Error(options.fail)
      return { content: [{ type: 'text', text: '20260930-090000-abcdef1' }] }
    },
    logger: {
      info: (message) => logs.push(`info:${message}`),
      warn: (message) => logs.push(`warn:${message}`),
    },
  }
}

test('given official mirrored rules, when classifying snapshot need, then reads skip and local writes hit', () => {
  // 官方 safeActions / effects → 免快照
  assert.equal(needsSnapshot('document', { action: 'list' }), false)
  assert.equal(needsSnapshot('document', { action: 'get' }), false)
  assert.equal(needsSnapshot('sql', { stmt: 'SELECT 1' }), false, 'safeWholeTools')
  assert.equal(needsSnapshot('web_fetch', { url: 'https://x' }), false, 'safeWholeTools')
  assert.equal(needsSnapshot('search', { action: 'semantic' }), false, 'ActionEffects.LocalRead')
  assert.equal(needsSnapshot('asset', { action: 'stat' }), false, 'ActionEffects.LocalRead')
  assert.equal(needsSnapshot('export', { action: 'html' }), false, 'safeNativeToolActions')
  assert.equal(needsSnapshot('http_request', { action: 'post' }), false, 'External 作用域')
  assert.equal(needsSnapshot('repo', { action: 'create' }), false, '快照自身免快照（防递归）')

  // 本地写 → 需要快照
  assert.equal(needsSnapshot('document', { action: 'move' }), true)
  assert.equal(needsSnapshot('document', { action: 'delete' }), true)
  assert.equal(needsSnapshot('block', { action: 'update' }), true)
  assert.equal(needsSnapshot('image', { action: 'generate' }), true, 'ActionEffects.LocalWrite')
  assert.equal(needsSnapshot('asset', { action: 'upload' }), true, 'ActionEffects.LocalWrite')
  assert.equal(needsSnapshot('bazaar', { action: 'install' }), true, 'ActionEffects.LocalWrite')
  assert.equal(needsSnapshot('skill', { action: 'save' }), true, 'ActionEffects.LocalWrite')
  assert.equal(needsSnapshot('import', { action: 'md' }), true, 'import md 强制视为写')
  assert.equal(needsSnapshot('export', { action: 'zip' }), true)
  assert.equal(needsSnapshot('document', {}), true, '无 action 且非只读工具按写处理')
  assert.equal(needsSnapshot('repo', { action: 'purge' }), true)
})

test('given a first write, when the guard runs, then exactly one snapshot with the official-style memo', async () => {
  const deps = fakeDeps()
  const guard = createSnapshotGuard(configWith(), deps)
  await guard.beforeWrite(entry('document'), { action: 'create' })
  await guard.beforeWrite(entry('document'), { action: 'move' })
  assert.deepEqual(deps.calls, [SNAPSHOT_MEMO], '每会话只打一次')
  assert.ok(deps.logs.some((line) => line.includes('snapshot created')))
})

test('given reads and snapshot-excluded calls, when the guard runs, then no snapshot is taken', async () => {
  const deps = fakeDeps()
  const guard = createSnapshotGuard(configWith(), deps)
  await guard.beforeWrite(entry('document'), { action: 'list' })
  await guard.beforeWrite(entry('repo'), { action: 'create' })
  await guard.beforeWrite(entry('web_fetch'), { url: 'https://x' })
  assert.deepEqual(deps.calls, [])
})

test('given snapshot disabled, when the guard runs, then writes proceed untouched', async () => {
  const deps = fakeDeps()
  const guard = createSnapshotGuard(configWith({ snapshotBeforeWrite: false }), deps)
  await guard.beforeWrite(entry('document'), { action: 'delete' })
  assert.deepEqual(deps.calls, [])
})

test('given snapshot failure with abort policy, when a write runs, then it is blocked with context and retried later', async () => {
  const deps = fakeDeps({ fail: 'repo key missing' })
  const guard = createSnapshotGuard(configWith(), deps)
  await assert.rejects(
    guard.beforeWrite(entry('document'), { action: 'move' }),
    /思源写操作已中止：数据历史快照失败（repo key missing）/,
  )
  assert.deepEqual(deps.calls, [SNAPSHOT_MEMO], '失败不记成功，下次写还会尝试')

  // 恢复后下一次写先补快照再放行
  const ok = fakeDeps()
  const guardOk = createSnapshotGuard(configWith(), ok)
  await guardOk.beforeWrite(entry('document'), { action: 'move' })
  assert.deepEqual(ok.calls, [SNAPSHOT_MEMO])
})

test('given snapshot failure with warn policy, when a write runs, then it is allowed but logged', async () => {
  const deps = fakeDeps({ fail: 'repo disabled' })
  const guard = createSnapshotGuard(configWith({ snapshotFailure: 'warn' }), deps)
  await guard.beforeWrite(entry('document'), { action: 'move' })
  assert.ok(deps.logs.some((line) => line.startsWith('warn:') && line.includes('repo disabled')))
})
