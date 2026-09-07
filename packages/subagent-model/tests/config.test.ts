import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SubagentModelConfig } from '../src/config.ts'
import {
  Config,
  DEFAULT_ENTRY,
  EFFORT_DEFAULT,
  EFFORT_INHERIT,
  entryFor,
  mergeAgentOptions,
  resolveEntry,
  validateEntries,
  validateEntry,
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
    resolveEntry({
      enabled: true,
      provider: '',
      model: '',
      reasoningEffort: EFFORT_INHERIT,
    }),
    undefined,
  )
  assert.equal(
    resolveEntry({
      enabled: false,
      provider: 'deepseek',
      model: 'm',
      reasoningEffort: 'max',
    }),
    undefined,
  )
})

test('given an explicit entry, when resolved, then provider/model/effort are stamped', () => {
  assert.deepEqual(
    resolveEntry({
      enabled: true,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    }),
    {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    },
  )
})

test('given effort default sentinel, when resolved, then carried as the explicit default marker', () => {
  assert.deepEqual(
    resolveEntry({
      enabled: true,
      provider: 'deepseek',
      model: 'm',
      reasoningEffort: EFFORT_DEFAULT,
    }),
    { provider: 'deepseek', model: 'm', reasoningEffort: EFFORT_DEFAULT },
  )
})

test('given provider-only or effort-only entries, when resolved, then partial injection is preserved', () => {
  assert.deepEqual(
    resolveEntry({
      enabled: true,
      provider: 'deepseek',
      model: '',
      reasoningEffort: EFFORT_INHERIT,
    }),
    { provider: 'deepseek' },
  )
  assert.deepEqual(
    resolveEntry({
      enabled: true,
      provider: '',
      model: '',
      reasoningEffort: 'low',
    }),
    { reasoningEffort: 'low' },
  )
})

test('given an unknown provider, when the default entry exists, then the default route applies', () => {
  const cfg: SubagentModelConfig = {
    enabled: true,
    entries: {
      [DEFAULT_ENTRY]: {
        enabled: true,
        provider: 'newapi-chatds',
        model: 'deepseek-v4-flash',
        reasoningEffort: EFFORT_INHERIT,
      },
    },
  }
  // spawn/fork 都未单独配置 → 共享 default 路由（用户"双条目合并为单条路由"的诉求）
  assert.deepEqual(
    entryFor(() => cfg, 'spawn'),
    {
      provider: 'newapi-chatds',
      model: 'deepseek-v4-flash',
    },
  )
  assert.deepEqual(
    entryFor(() => cfg, 'fork'),
    {
      provider: 'newapi-chatds',
      model: 'deepseek-v4-flash',
    },
  )
})

test('given a concrete entry, when the default entry also exists, then the concrete one wins', () => {
  const cfg: SubagentModelConfig = {
    enabled: true,
    entries: {
      spawn: {
        enabled: true,
        provider: 'kimi-coding',
        model: 'k3',
        reasoningEffort: 'max',
      },
      [DEFAULT_ENTRY]: {
        enabled: true,
        provider: 'newapi-chatds',
        model: 'deepseek-v4-flash',
        reasoningEffort: EFFORT_INHERIT,
      },
    },
  }
  assert.deepEqual(
    entryFor(() => cfg, 'spawn'),
    {
      provider: 'kimi-coding',
      model: 'k3',
      reasoningEffort: 'max',
    },
  )
  assert.deepEqual(
    entryFor(() => cfg, 'fork'),
    {
      provider: 'newapi-chatds',
      model: 'deepseek-v4-flash',
    },
  )
})

test('given the global switch is off, when resolving any provider, then nothing is injected', () => {
  const cfg: SubagentModelConfig = {
    enabled: false,
    entries: {
      spawn: {
        enabled: true,
        provider: 'deepseek',
        model: 'm',
        reasoningEffort: EFFORT_INHERIT,
      },
    },
  }
  assert.equal(
    entryFor(() => cfg, 'spawn'),
    undefined,
  )
})

test('given an existing tool-line agentOptions, when merged, then the explicit values win on conflicts', () => {
  const injected = { provider: 'newapi-chatds', model: 'deepseek-v4-flash' }
  assert.deepEqual(mergeAgentOptions(injected, undefined), injected)
  // 主代理显式选择的路由（官方 model 字段）优先于插件默认
  assert.deepEqual(mergeAgentOptions(injected, { provider: 'openai', model: 'gpt-5.6-sol' }), {
    provider: 'openai',
    model: 'gpt-5.6-sol',
  })
  // 显式只给 effort 时，provider/model 仍取插件默认
  assert.deepEqual(mergeAgentOptions(injected, { reasoningEffort: 'low' }), {
    provider: 'newapi-chatds',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'low',
  })
})

test('given entry validation, when model is set without provider, then it is rejected', () => {
  assert.equal(
    validateEntry({ provider: '', model: 'm' }),
    'model 不能脱离 provider 单独配置（请先选择提供商或改回继承）',
  )
  assert.equal(
    validateEntry({ provider: 'p', model: 'm', reasoningEffort: '' }),
    'reasoningEffort 不能为空（inherit / default / 档位 id）',
  )
  assert.equal(validateEntry({ provider: 'p', model: 'm', reasoningEffort: 'max' }), null)
})

test('given entries validation, when one entry is invalid, then the entry name is reported', () => {
  assert.equal(
    validateEntries({
      spawn: { provider: 'p', model: 'm', reasoningEffort: 'max' },
      fork: { provider: '', model: 'm' },
    }),
    '条目 fork: model 不能脱离 provider 单独配置（请先选择提供商或改回继承）',
  )
  assert.equal(
    validateEntries({ spawn: { provider: 'p', model: 'm', reasoningEffort: 'max' } }),
    null,
  )
})
