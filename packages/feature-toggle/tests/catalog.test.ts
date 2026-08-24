import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CATALOG,
  catalogViolations,
  FORBIDDEN_ROWS,
  findFeature,
  hostRows,
  invalidFeatureKeys,
  presetRows,
} from '../src/catalog.ts'

test('given compiled catalog, when self-checking, then no violations', () => {
  assert.deepEqual(catalogViolations(), [])
})

test('given catalog, when checking plane disjointness invariants, then host and preset rows never overlap', () => {
  const host = hostRows()
  const preset = presetRows()
  for (const row of host) assert.ok(!preset.has(row), `行 ${row} 不应同时出现在两个平面`)
})

test('given forbidden row list, when scanning catalog rows, then none present', () => {
  const rows = [...hostRows(), ...presetRows()]
  for (const row of rows) assert.ok(!FORBIDDEN_ROWS.includes(row), `核心行 ${row} 绝不可进入目录`)
})

test('given subagents feature, when inspecting rows, then delegation group and both backends covered', () => {
  const feature = findFeature('subagents')
  assert.ok(feature !== undefined)
  assert.deepEqual(feature.rows.preset, ['delegation'])
  assert.deepEqual([...feature.rows.host].sort(), [
    'subagent-fork-in-process',
    'subagent-spawn-in-process',
  ])
  assert.equal(feature.effect, 'new-session')
})

test('given unknown feature key, when validating desired state, then reported as invalid', () => {
  assert.deepEqual(invalidFeatureKeys({ subagents: false, 'nonexistent-feature': true }), [
    'nonexistent-feature',
  ])
  assert.deepEqual(invalidFeatureKeys({ 'web-search': false }), [])
})

test('given catalog, when checking subagent registry row absence, then subagent and report rows never toggled', () => {
  const rows = [...hostRows(), ...presetRows()]
  assert.ok(!rows.includes('subagent'), 'subagent 注册表行是 api-proxy 硬依赖')
  assert.ok(!rows.includes('tool-subagent-report'), 'report 行是 host 平面 continuable setup')
  assert.ok(!rows.includes('dsh-plus-lifeboat'), '救生艇自身不可被关闭')
  assert.ok(!rows.includes('dsh-plus-feature-toggle'), '本插件自身不可被关闭')
  assert.ok(!rows.includes('dsh-plus-llm-pi'), 'llm-pi 是默认模型路由')
})

test('given every catalog entry, when checking id uniqueness, then ids are unique', () => {
  const ids = CATALOG.map((feature) => feature.id)
  assert.equal(new Set(ids).size, ids.length)
})
