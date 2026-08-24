import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CATALOG } from '../src/catalog.ts'
import { detectDrift, hasMissingRows } from '../src/drift.ts'
import { verifyLoaderState } from '../src/loader-check.ts'

/** 从真实官方 standard 预设提取的行 id 子集（漂移对拍的真实基准形态）。 */
const STANDARD_ROWS = new Set([
  'persona',
  'agent-instructions',
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
  'tool-jobs',
  'skill-filesystem',
  'tool-skill',
  'tool-goal',
  'planning',
  'plan-mode',
  'compaction',
  'compaction-basic',
  'command-compact',
  'tool-result-pruner',
  'delegation',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-subagent-codex',
  'tool-subagent-claude-code',
  'workflow-worker-thread',
  'tool-workflow',
  'tool-ralph',
  'tool-ask-user',
  'tool-todo',
  'tool-web',
])

// ── drift：目录对拍 ──

test('given intact official preset, when drift-checking, then no findings', () => {
  const findings = detectDrift(STANDARD_ROWS, 'preset')
  assert.deepEqual(
    findings.map((f) => f.kind),
    [],
    `catalog 与 standard 预设应当完全对齐（发现: ${JSON.stringify(findings)}）`,
  )
})

test('given official removed delegation group, when drift-checking, then missing-row reported for subagents', () => {
  const rows = new Set(STANDARD_ROWS)
  rows.delete('delegation')
  const findings = detectDrift(rows, 'preset')
  const missing = findings.filter((f) => f.kind === 'missing-row')
  assert.equal(missing.length, 1)
  assert.equal(missing[0]?.subject, 'delegation')
  assert.ok(missing[0]?.detail.includes('subagents'))
  assert.ok(hasMissingRows(findings))
})

test('given official added sibling row (renamed group), when drift-checking, then suspected-new-row reported', () => {
  const rows = new Set(STANDARD_ROWS)
  rows.delete('delegation')
  rows.add('delegation-v2')
  const findings = detectDrift(rows, 'preset')
  const suspected = findings.filter((f) => f.kind === 'suspected-new-row')
  assert.equal(suspected.length, 1)
  assert.equal(suspected[0]?.subject, 'delegation-v2')
  assert.ok(suspected[0]?.detail.includes('subagents'))
})

test('given unrelated new rows (no catalog prefix family), when drift-checking, then no suspected findings', () => {
  const rows = new Set(STANDARD_ROWS)
  rows.add('brand-new-capability')
  rows.add('tool-xyz')
  const findings = detectDrift(rows, 'preset')
  assert.deepEqual(findings, [])
})

test('given subagent backend rename on host plane, when drift-checking host rows, then rename detected as missing+new pair', () => {
  // host 平面对拍形态：官方把 subagent-spawn-in-process 改名
  const rows = new Set(['subagent-spawn-in-process-v2', 'subagent-fork-in-process'])
  const findings = detectDrift(rows, 'host')
  const missing = findings.filter((f) => f.kind === 'missing-row').map((f) => f.subject)
  const suspected = findings.filter((f) => f.kind === 'suspected-new-row').map((f) => f.subject)
  assert.ok(missing.includes('subagent-spawn-in-process'))
  assert.ok(suspected.includes('subagent-spawn-in-process-v2'))
})

// ── loader-check：闭环验证 ──

test('given loader reflects disabled state, when verifying, then ok', () => {
  const entries = [
    { entryId: 'include:dsh-plus-reload', enabled: false },
    { entryId: 'include:dsh-plus-notify-email', enabled: true },
  ]
  const outcome = verifyLoaderState(
    new Set(['dsh-plus-reload']),
    new Set(['dsh-plus-reload']),
    entries,
  )
  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.mismatched, [])
})

test('given hot-apply did not take effect, when verifying, then mismatched and pendingRestart warranted', () => {
  const entries = [{ entryId: 'include:dsh-plus-reload', enabled: true }]
  const outcome = verifyLoaderState(
    new Set(['dsh-plus-reload']),
    new Set(['dsh-plus-reload']),
    entries,
  )
  assert.equal(outcome.ok, false)
  assert.deepEqual(outcome.mismatched, ['dsh-plus-reload'])
})

test('given target row absent from loader view (renamed upstream), when verifying, then counted as mismatched', () => {
  const entries = [{ entryId: 'include:other-row', enabled: true }]
  const outcome = verifyLoaderState(
    new Set(['subagent-spawn-in-process']),
    new Set(['subagent-spawn-in-process']),
    entries,
  )
  assert.equal(outcome.ok, false)
  assert.deepEqual(outcome.mismatched, ['subagent-spawn-in-process'])
})

test('given nested group entry ids, when verifying, then last segment matches target row', () => {
  const entries = [
    { entryId: 'include:agent-presets:delegation', enabled: true },
    { entryId: 'include:dsh-plus-reload', enabled: false },
  ]
  // delegation 期望禁用但 agent-presets 域内仍启用（嵌套视图存在）→ 以出现即计入
  const outcome = verifyLoaderState(
    new Set(['dsh-plus-reload']),
    new Set(['dsh-plus-reload']),
    entries,
  )
  assert.equal(outcome.ok, true)
})

test('given expected-enabled row actually disabled, when verifying, then mismatched', () => {
  const entries = [{ entryId: 'include:dsh-plus-reload', enabled: false }]
  const outcome = verifyLoaderState(new Set(['dsh-plus-reload']), new Set(), entries)
  assert.equal(outcome.ok, false)
  assert.deepEqual(outcome.mismatched, ['dsh-plus-reload'])
})

// ── catalog 与 standard 真实快照的持续对齐（升级守门）──

test('given compiled catalog preset rows, when checking against frozen standard snapshot, then all present', () => {
  const presetRows = new Set<string>()
  for (const feature of CATALOG) {
    for (const row of feature.rows.preset) presetRows.add(row)
  }
  for (const row of presetRows) {
    assert.ok(
      STANDARD_ROWS.has(row),
      `catalog 行 ${row} 不在冻结的 standard 快照中——官方预设结构已变化，请同步 catalog 与本快照`,
    )
  }
})
