import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PresetFileState } from '../src/preset-file.ts'
import { desiredRows, needsManagedPreset, plan } from '../src/reconcile.ts'

function presetState(present: string[], disabled: string[]): PresetFileState {
  const state: PresetFileState = { disabled: new Map(), present: new Set(present) }
  for (const row of disabled) state.disabled.set(row, true)
  for (const row of present) if (!state.disabled.has(row)) state.disabled.set(row, false)
  return state
}

const EMPTY_PATCH = { managed: [], external: [] }

test('given subagents disabled, when deriving rows, then delegation group and both backends included', () => {
  const rows = desiredRows({ subagents: false })
  assert.deepEqual([...rows.preset], ['delegation'])
  assert.deepEqual([...rows.host].sort(), ['subagent-fork-in-process', 'subagent-spawn-in-process'])
  assert.ok(needsManagedPreset({ subagents: false }))
  assert.ok(!needsManagedPreset({ 'dsh-plus-reload': false }))
})

test('given empty desired state, when planning, then no actions and no managed preset needed', () => {
  const result = plan({
    desired: {},
    patch: EMPTY_PATCH,
    preset: undefined,
    loader: new Map(),
    quarantined: new Set(),
  })
  assert.deepEqual(result.actions, [])
  assert.deepEqual(result.rejected, [])
  assert.ok(!needsManagedPreset({}))
})

test('given host-plane disable, when planning, then patch-write with target rows and no preset action', () => {
  const result = plan({
    desired: { 'dsh-plus-reload': false },
    patch: EMPTY_PATCH,
    preset: undefined,
    loader: new Map(),
    quarantined: new Set(),
  })
  const writes = result.actions.filter((a) => a.kind === 'patch-write')
  assert.equal(writes.length, 1)
  assert.deepEqual(
    [...(writes[0] as { disabledIds: Set<string> }).disabledIds],
    ['dsh-plus-reload'],
  )
  assert.ok(!result.actions.some((a) => a.kind === 'ensure-managed-preset'))
})

test('given subagents disable, when planning, then ensure-managed-preset precedes preset-write', () => {
  const result = plan({
    desired: { subagents: false },
    patch: EMPTY_PATCH,
    preset: presetState(['delegation', 'tool-web'], []),
    loader: new Map(),
    quarantined: new Set(),
  })
  const kinds = result.actions.map((a) => a.kind)
  assert.ok(kinds.includes('ensure-managed-preset'))
  assert.ok(kinds.includes('preset-write'))
  assert.ok(kinds.indexOf('ensure-managed-preset') < kinds.indexOf('preset-write'))
  const presetWrite = result.actions.find((a) => a.kind === 'preset-write') as {
    disabledIds: Set<string>
  }
  assert.deepEqual([...presetWrite.disabledIds], ['delegation'])
})

test('given quarantined plugin with enable desired, when planning, then enable rejected and disable maintained', () => {
  const result = plan({
    desired: { 'dsh-plus-web-files': true },
    patch: EMPTY_PATCH,
    preset: undefined,
    loader: new Map(),
    quarantined: new Set(['dsh-plus-web-files']),
  })
  assert.equal(result.rejected.length, 1)
  assert.equal(result.rejected[0]?.feature, 'dsh-plus-web-files')
  assert.equal(result.rejected[0]?.row, 'dsh-plus-web-files')
  // 被拒绝 → 维持禁用：应有 patch-write 把它写禁
  const patchWrite = result.actions.find((a) => a.kind === 'patch-write') as
    | {
        disabledIds: Set<string>
      }
    | undefined
  assert.ok(patchWrite !== undefined)
  assert.ok(patchWrite.disabledIds.has('dsh-plus-web-files'))
})

test('given quarantined plugin with disable desired, when planning, then no rejection (state already consistent)', () => {
  const result = plan({
    desired: { 'dsh-plus-web-files': false },
    patch: EMPTY_PATCH,
    preset: undefined,
    loader: new Map(),
    quarantined: new Set(['dsh-plus-web-files']),
  })
  assert.deepEqual(result.rejected, [])
})

test('given external disable already in patch file, when planning, then managed entry not duplicated', () => {
  const result = plan({
    desired: { 'dsh-plus-web-files': false },
    patch: { managed: [], external: [{ id: 'dsh-plus-web-files', disabled: true }] },
    preset: undefined,
    loader: new Map(),
    quarantined: new Set(),
  })
  const patchWrite = result.actions.find((a) => a.kind === 'patch-write') as
    | {
        disabledIds: Set<string>
      }
    | undefined
  assert.ok(patchWrite === undefined || !patchWrite.disabledIds.has('dsh-plus-web-files'))
})

test('given stale managed entry for now-enabled feature, when planning, then patch-write clears it', () => {
  const result = plan({
    desired: { 'dsh-plus-reload': true },
    patch: { managed: [{ id: 'dsh-plus-reload', disabled: true }], external: [] },
    preset: undefined,
    loader: new Map(),
    quarantined: new Set(),
  })
  const patchWrite = result.actions.find((a) => a.kind === 'patch-write') as {
    disabledIds: Set<string>
  }
  assert.ok(patchWrite !== undefined)
  assert.ok(!patchWrite.disabledIds.has('dsh-plus-reload'))
})

test('given preset rows disabled but feature re-enabled, when planning, then preset-write clears marks', () => {
  const result = plan({
    desired: { subagents: true },
    patch: EMPTY_PATCH,
    preset: presetState(['delegation', 'tool-web'], ['delegation']),
    loader: new Map(),
    quarantined: new Set(),
  })
  const presetWrite = result.actions.find((a) => a.kind === 'preset-write') as
    | {
        disabledIds: Set<string>
      }
    | undefined
  assert.ok(presetWrite !== undefined)
  assert.ok(!presetWrite.disabledIds.has('delegation'))
})

test('given no preset-plane desires but stale preset marks, when planning, then marks cleared without pointer change', () => {
  const result = plan({
    desired: { 'dsh-plus-reload': false }, // 仅 host 平面
    patch: EMPTY_PATCH,
    preset: presetState(['delegation'], ['delegation']), // 预设残留禁用标记
    loader: new Map(),
    quarantined: new Set(),
  })
  const kinds = result.actions.map((a) => a.kind)
  assert.ok(kinds.includes('preset-write'))
  const presetWrite = result.actions.find((a) => a.kind === 'preset-write') as {
    disabledIds: Set<string>
  }
  assert.equal(presetWrite.disabledIds.size, 0)
})

test('given disable action with both planes, when ordering, then preset-write precedes patch-write', () => {
  const result = plan({
    desired: { subagents: false, 'dsh-plus-reload': false },
    patch: EMPTY_PATCH,
    preset: presetState(['delegation'], []),
    loader: new Map(),
    quarantined: new Set(),
  })
  const kinds = result.actions.map((a) => a.kind)
  const presetIdx = kinds.indexOf('preset-write')
  const patchIdx = kinds.indexOf('patch-write')
  assert.ok(presetIdx >= 0 && patchIdx >= 0)
  assert.ok(presetIdx < patchIdx, `禁用路径 preset 应先于 host（${kinds.join(',')}）`)
})
