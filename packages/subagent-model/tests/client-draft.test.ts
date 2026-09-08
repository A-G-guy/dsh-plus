import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ModelCatalog } from '../src/client/api.ts'
import { draftFrom, EMPTY_ROW, toPatch } from '../src/client/draft.ts'

const ENTRY = { enabled: true, provider: 'kimi', model: 'k3', reasoningEffort: 'inherit' }
const catalogOf = (...subagentProviders: string[]): ModelCatalog => ({
  providers: [],
  failures: [],
  subagentProviders,
})

test('given configured entries and catalog rows, when seeded in either order, then toPatch is identical', () => {
  const value = { enabled: false, entries: { fork: ENTRY } }
  // 路径 A：draftFrom 直构（目录行在前）
  const direct = draftFrom(value, catalogOf('spawn'))
  // 路径 B：卡片实际的两步播种——先仅 entries（目录未到），后补目录空行
  const stepSeeded = draftFrom(value, null)
  const rows = { ...stepSeeded.rows, spawn: { ...EMPTY_ROW } }
  const twoStep = { ...stepSeeded, rows }
  // 未做任何编辑时 dirty 判定（JSON.stringify(toPatch(...)) 比较）不得因键序出现假阳性
  assert.equal(JSON.stringify(toPatch(twoStep)), JSON.stringify(toPatch(direct)))
})

test('given catalog null, when seeding, then only configured entries form rows', () => {
  const draft = draftFrom({ enabled: true, entries: { fork: ENTRY } }, null)
  assert.deepEqual(Object.keys(draft.rows), ['fork'])
  assert.equal(draft.enabled, true)
})

test('given a catalog-only provider, when seeding, then it gets an empty default row', () => {
  const draft = draftFrom({ enabled: false, entries: {} }, catalogOf('spawn'))
  assert.deepEqual(draft.rows['spawn'], EMPTY_ROW)
})

test('given an edited row, when patched, then the change survives sorted materialization', () => {
  const draft = draftFrom({ enabled: false, entries: { fork: ENTRY } }, catalogOf('spawn'))
  const edited = {
    ...draft,
    rows: { ...draft.rows, spawn: { ...EMPTY_ROW, enabled: true, provider: 'deepseek' } },
  }
  const patch = toPatch(edited) as { entries: Record<string, unknown> }
  assert.deepEqual(Object.keys(patch.entries), ['fork', 'spawn'])
  assert.equal((patch.entries['spawn'] as { provider: string }).provider, 'deepseek')
})
