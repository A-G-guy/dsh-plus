import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import { Config, DROPPED_ROWS, LEAN_PRESET_ID, leanPresetDefinition } from '../src/index.ts'

type Row = PresetDefinition['plugins'][number]

/** 默认配置下的行清单。 */
function rows(): Row[] {
  return [...leanPresetDefinition(Config({}) as Parameters<typeof leanPresetDefinition>[0]).plugins]
}

/** 深度优先展开组行，返回每一行（含组自身）。 */
function flatten(list: readonly Row[]): Row[] {
  const out: Row[] = []
  for (const row of list) {
    out.push(row)
    const children = row.group === true && Array.isArray(row.config) ? (row.config as Row[]) : []
    out.push(...flatten(children))
  }
  return out
}

/** 平台门控表达式的字符串（非表达式返回 undefined）。 */
function gating(row: Row): string | undefined {
  const disabled = row.disabled as { __jsExpr?: string } | boolean | null | undefined
  return typeof disabled === 'object' && disabled !== null ? disabled.__jsExpr : undefined
}

test('Given 精简模式声明 When 展开行清单 Then id 唯一且能力行全部来自官方包', () => {
  const list = flatten(rows())
  const ids = list.map((row) => row.id)
  assert.equal(new Set(ids).size, ids.length, `行 id 重复：${ids.join(', ')}`)
  for (const row of list) {
    assert.ok(
      row.name === 'cordis:group' || row.name.startsWith('@deepseek-ai/'),
      `行 ${String(row.id)} 引用了非官方实现：${row.name}`,
    )
  }
})

test('Given 精简模式声明 When 应用默认配置 Then 注册身份固定为 lean', () => {
  const definition = leanPresetDefinition(Config({}) as Parameters<typeof leanPresetDefinition>[0])
  assert.equal(definition.id, LEAN_PRESET_ID)
  assert.equal(definition.id, 'lean')
})

test('Given 精简模式声明 When 检查能力面 Then 核心行在位、去除行缺席', () => {
  const ids = new Set(flatten(rows()).map((row) => row.id))
  const required = [
    'persona',
    'agent-instructions',
    'time-context',
    'tool-bash',
    'tool-pwsh',
    'tool-fs',
    'tool-jobs',
    'skill-filesystem',
    'tool-skill',
    'planning',
    'plan-mode',
    'compaction',
    'compaction-basic',
    'command-compact',
    'tool-result-pruner',
    'tool-ask-user',
    'tool-todo',
    'tool-web',
    'present',
  ]
  for (const id of required) assert.ok(ids.has(id), `缺少能力行：${id}`)
  for (const id of DROPPED_ROWS) assert.ok(!ids.has(id), `去除清单中的行仍在声明里：${id}`)
})

test('Given 需要 realm 的组行 When 检查声明 Then group/isolate 齐备', () => {
  const list = rows()
  const planning = list.find((row) => row.id === 'planning')
  const compaction = list.find((row) => row.id === 'compaction')
  assert.equal(planning?.name, 'cordis:group')
  assert.equal(planning?.group, true)
  assert.deepEqual(planning?.isolate, { planMode: true })
  assert.equal(compaction?.name, 'cordis:group')
  assert.equal(compaction?.group, true)
  assert.deepEqual(compaction?.isolate, { compaction: true, toolResultPruner: true })
  for (const group of [planning, compaction]) {
    assert.ok(Array.isArray(group?.config) && group.config.length > 0)
  }
})

test('Given shell 平台门控 When 检查声明 Then 用官方 !!js 表达式且两行互补', () => {
  const list = rows()
  const bash = list.find((row) => row.id === 'tool-bash')
  const pwsh = list.find((row) => row.id === 'tool-pwsh')
  assert.equal(bash?.name, '@deepseek-ai/dsh-tool-bash')
  assert.equal(pwsh?.name, '@deepseek-ai/dsh-tool-pwsh')
  assert.equal(gating(bash as Row), "process.platform === 'win32'")
  assert.equal(gating(pwsh as Row), "process.platform !== 'win32'")
})

test('Given 去除清单 When 检查条目 Then 无重复、无空项', () => {
  assert.equal(new Set(DROPPED_ROWS).size, DROPPED_ROWS.length)
  for (const id of DROPPED_ROWS) assert.ok(id.trim() !== '')
})
