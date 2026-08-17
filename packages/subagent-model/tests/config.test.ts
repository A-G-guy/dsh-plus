import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyEffort, Config, EFFORT_DEFAULT, EFFORT_INHERIT, mergeAgentOptions, resolveEntry,
  toUserPatch, toWire, validateEntry, WirePatch,
} from '../src/config.ts'

test('given empty config, when schema resolves, then safe defaults apply (disabled, no entries)', () => {
  const cfg = Config({})
  assert.equal(cfg.enabled, false)
  assert.deepEqual(cfg.entries, {})
})

test('given a partial entry, when schema resolves, then inherit defaults fill gaps', () => {
  const cfg = Config({ entries: { spawn: { enabled: true } } })
  const entry = cfg.entries['spawn']
  assert.ok(entry !== undefined)
  assert.equal(entry.provider, '')
  assert.equal(entry.model, '')
  assert.equal(entry.reasoningEffort, EFFORT_INHERIT)
})

test('given a disabled or all-inherit entry, when resolved, then nothing is injected', () => {
  assert.equal(
    resolveEntry({ enabled: true, provider: '', model: '', reasoningEffort: EFFORT_INHERIT }),
    undefined,
  )
  assert.equal(
    resolveEntry({ enabled: false, provider: 'deepseek', model: 'm', reasoningEffort: 'max' }),
    undefined,
  )
})

test('given an explicit entry, when resolved, then provider/model/effort are stamped', () => {
  assert.deepEqual(
    resolveEntry({ enabled: true, provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' }),
    { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
  )
})

test('given effort default sentinel, when resolved, then carried as the explicit default marker', () => {
  assert.deepEqual(
    resolveEntry({ enabled: true, provider: 'deepseek', model: 'm', reasoningEffort: EFFORT_DEFAULT }),
    { provider: 'deepseek', model: 'm', reasoningEffort: EFFORT_DEFAULT },
  )
})

test('given provider-only or effort-only entries, when resolved, then partial injection is preserved', () => {
  assert.deepEqual(
    resolveEntry({ enabled: true, provider: 'deepseek', model: '', reasoningEffort: EFFORT_INHERIT }),
    { provider: 'deepseek' },
  )
  assert.deepEqual(
    resolveEntry({ enabled: true, provider: '', model: '', reasoningEffort: 'high' }),
    { reasoningEffort: 'high' },
  )
})

test('given conflicting options, when merged, then existing tool-line agentOptions wins', () => {
  const merged = mergeAgentOptions(
    { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
    { provider: 'kimi-coding', model: 'k3' },
  )
  assert.deepEqual(merged, { provider: 'kimi-coding', model: 'k3', reasoningEffort: 'max' })
  assert.deepEqual(mergeAgentOptions({ provider: 'deepseek' }, undefined), { provider: 'deepseek' })
})

test('given a request config, when effort applied, then undefined passes through, default strips, id overrides', () => {
  const base = { provider: 'deepseek', model: 'm', reasoningEffort: 'high' as string | undefined, maxTokens: 8000 }
  assert.deepEqual(applyEffort(base, undefined), base)
  assert.deepEqual(applyEffort(base, EFFORT_DEFAULT), { provider: 'deepseek', model: 'm', maxTokens: 8000 })
  assert.deepEqual(applyEffort(base, 'max'), { ...base, reasoningEffort: 'max' })
})

test('given entry validation, when model set without provider, then rejected with a message', () => {
  const modelOnly = validateEntry({ enabled: true, provider: '', model: 'm', reasoningEffort: EFFORT_INHERIT })
  assert.ok(modelOnly !== null && modelOnly.length > 0)
  const emptyEffort = validateEntry({ enabled: true, provider: 'p', model: 'm', reasoningEffort: '' })
  assert.ok(emptyEffort !== null && emptyEffort.length > 0)
  assert.equal(validateEntry({ enabled: true, provider: '', model: '', reasoningEffort: EFFORT_INHERIT }), null)
  assert.equal(validateEntry({ enabled: true, provider: 'p', model: 'm', reasoningEffort: EFFORT_INHERIT }), null)
  assert.equal(validateEntry({ enabled: true, provider: 'p', model: 'm', reasoningEffort: 'max' }), null)
})

test('given config with entries, when serialized for the wire, then entries and provider list round-trip', () => {
  const cfg = Config({ enabled: true, entries: { spawn: { enabled: true, provider: 'deepseek', model: 'm', reasoningEffort: 'max' } } })
  const wire = toWire(cfg, ['spawn', 'fork'], true)
  assert.equal(wire.enabled, true)
  assert.deepEqual(wire.subagentProviders, ['spawn', 'fork'])
  assert.deepEqual(wire.entries['spawn'], { enabled: true, provider: 'deepseek', model: 'm', reasoningEffort: 'max' })
  assert.equal(wire.writable, true)
})

test('given a card patch, when validated and mapped, then entries map replaces wholesale', () => {
  const patch = WirePatch({
    enabled: true,
    entries: { spawn: { enabled: false, provider: '', model: '', reasoningEffort: EFFORT_INHERIT } },
  })
  assert.deepEqual(toUserPatch(patch), {
    enabled: true,
    entries: { spawn: { enabled: false, provider: '', model: '', reasoningEffort: EFFORT_INHERIT } },
  })
  assert.throws(() => WirePatch({ enabled: true, entries: { spawn: { enabled: 'yes' } } }))
})
