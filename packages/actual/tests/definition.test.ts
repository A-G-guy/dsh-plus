import assert from 'node:assert/strict'
import { test } from 'node:test'

import { unwrapVolatile } from '@dsh-plus/shared'

import { type ActualConfig, Config } from '../src/config.ts'
import {
  ACTUAL_PRESET_ID,
  actualPresetDefinition,
  resolvePersonaPrefix,
} from '../src/definition.ts'
import { DEFAULT_PERSONA_PREFIX } from '../src/prompt.ts'

/**
 * 以 schema 补默认，得到平面配置（等价加载器行为：`Config({})` 产出的是
 * volatile 活动引用，消费面必须先 `unwrapVolatile` 解包——生产代码同理）。
 */
function configWith(overrides: Partial<ActualConfig> = {}): ActualConfig {
  return { ...unwrapVolatile(Config({})), ...overrides } as ActualConfig
}

test('given default config, when building the preset, then operations stay Actual-only with three auxiliary rows', () => {
  const definition = actualPresetDefinition(configWith())
  assert.equal(definition.id, ACTUAL_PRESET_ID)
  assert.equal(definition.name, 'Actual Budget')
  assert.deepEqual(
    definition.plugins.map((row) => row.name),
    [
      '@deepseek-ai/dsh-persona',
      '@dsh-plus/actual-tools',
      '@deepseek-ai/dsh-tool-web',
      '@deepseek-ai/dsh-tool-ask-user',
      '@deepseek-ai/dsh-tool-todo',
    ],
    '操作面仅 Actual 派生工具 + 三行辅助工具，不得挂 bash/fs/edit/skill/subagent 等操作类官方行',
  )
  const persona = definition.plugins[0]?.config as Record<string, unknown> | undefined
  assert.equal(persona?.complete, true, 'complete 模式移除全部无关注入')
  assert.equal(persona?.includeRuntimeContext, true)
  assert.equal(persona?.prefix, DEFAULT_PERSONA_PREFIX)
  assert.deepEqual(definition.plugins[2]?.config, { fetch: true, searchTimeoutMs: 60_000 })
  assert.deepEqual(definition.plugins[4]?.config, { allowParallelInProgress: true })
})

test('given auxTools disabled, when building, then only persona and actual-tools compose it', () => {
  const definition = actualPresetDefinition(configWith({ auxTools: false }))
  assert.deepEqual(
    definition.plugins.map((row) => row.name),
    ['@deepseek-ai/dsh-persona', '@dsh-plus/actual-tools'],
  )
})

test('given persona overrides, when building, then custom prefix wins and runtime context follows config', () => {
  const definition = actualPresetDefinition(
    configWith({ personaPrefix: '  custom prompt  ', includeRuntimeContext: false, order: 3 }),
  )
  assert.equal(definition.order, 3)
  const persona = definition.plugins[0]?.config as Record<string, unknown>
  assert.equal(persona.prefix, '  custom prompt  ')
  assert.equal(persona.includeRuntimeContext, false)
  assert.equal(resolvePersonaPrefix(configWith({ personaPrefix: '' })), DEFAULT_PERSONA_PREFIX)
})

test('given safety config, when building, then the tool row receives policy knobs and no snapshot knobs', () => {
  const definition = actualPresetDefinition(
    configWith({
      confirmWrites: false,
      readActions: ['list'],
      alwaysAsk: ['sync'],
      readTools: ['sync'],
      namePrefix: 'ab_',
      toolCallTimeoutMs: 1234,
    }),
  )
  const toolsRow = definition.plugins[1]?.config as Record<string, unknown>
  assert.deepEqual(Object.keys(toolsRow).sort(), [
    'alwaysAsk',
    'confirmWrites',
    'namePrefix',
    'readActions',
    'readTools',
    'toolCallTimeoutMs',
  ])
  assert.equal(toolsRow.confirmWrites, false)
  assert.deepEqual(toolsRow.readActions, ['list'])
  assert.deepEqual(toolsRow.alwaysAsk, ['sync'])
  assert.deepEqual(toolsRow.readTools, ['sync'])
  assert.equal(toolsRow.namePrefix, 'ab_')
  assert.equal(toolsRow.toolCallTimeoutMs, 1234)
})

test('given the MCP format, when building the preset, then no MCP row is mounted', () => {
  const definition = actualPresetDefinition(configWith())
  assert.equal(
    definition.plugins.some((row) => row.name.includes('mcp-client')),
    false,
    '格式一仅作可移植件，不作为预设入口',
  )
})
