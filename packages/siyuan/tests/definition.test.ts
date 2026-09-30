import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, type SiyuanConfig } from '../src/config.ts'
import {
  resolvePersonaPrefix,
  SIYUAN_PRESET_ID,
  siyuanPresetDefinition,
} from '../src/definition.ts'
import { DEFAULT_PERSONA_PREFIX } from '../src/prompt.ts'

/** 以 schema 补默认，得到完整配置（等价加载器行为）。 */
function configWith(overrides: Partial<SiyuanConfig> = {}): SiyuanConfig {
  return { ...Config({}), ...overrides } as SiyuanConfig
}

test('given default config, when building the preset, then only persona and siyuan-tools compose it', () => {
  const definition = siyuanPresetDefinition(configWith())
  assert.equal(definition.id, SIYUAN_PRESET_ID)
  assert.equal(definition.name, '思源笔记')
  const rows = definition.plugins.map((row) => row.name)
  assert.deepEqual(
    rows,
    ['@deepseek-ai/dsh-persona', '@dsh-plus/siyuan-tools'],
    '不得挂任何官方工具行',
  )
  const persona = definition.plugins[0]
  assert.ok(persona !== undefined && persona.config !== undefined)
  const personaConfig = persona.config as Record<string, unknown>
  assert.equal(personaConfig.complete, true, 'complete 模式移除全部无关注入')
  assert.equal(personaConfig.includeRuntimeContext, true)
  assert.equal(personaConfig.prefix, DEFAULT_PERSONA_PREFIX)
})

test('given persona overrides, when building, then custom prefix wins and runtime context follows config', () => {
  const definition = siyuanPresetDefinition(
    configWith({ personaPrefix: '  custom prompt  ', includeRuntimeContext: false, order: 7 }),
  )
  assert.equal(definition.order, 7)
  const persona = definition.plugins[0]?.config as Record<string, unknown>
  assert.equal(persona.prefix, '  custom prompt  ')
  assert.equal(persona.includeRuntimeContext, false)
  assert.equal(resolvePersonaPrefix(configWith({ personaPrefix: '' })), DEFAULT_PERSONA_PREFIX)
})

test('given safety config, when building, then the tool row receives exposure and policy knobs', () => {
  const definition = siyuanPresetDefinition(
    configWith({
      confirmWrites: false,
      readActions: ['get'],
      alwaysAsk: ['sync'],
      readTools: ['sql'],
      namePrefix: 'sy_',
      toolCallTimeoutMs: 1234,
    }),
  )
  const toolsRow = definition.plugins[1]
  assert.ok(toolsRow !== undefined && toolsRow.config !== undefined)
  const config = toolsRow.config as Record<string, unknown>
  assert.equal(config.confirmWrites, false)
  assert.deepEqual(config.readActions, ['get'])
  assert.deepEqual(config.alwaysAsk, ['sync'])
  assert.deepEqual(config.readTools, ['sql'])
  assert.equal(config.namePrefix, 'sy_')
  assert.equal(config.toolCallTimeoutMs, 1234)
})
