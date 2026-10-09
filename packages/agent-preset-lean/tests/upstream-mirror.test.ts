import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { parse, type Tags } from 'yaml'

import { Config, DROPPED_ROWS, leanPresetDefinition } from '../src/index.ts'

type Row = PresetDefinition['plugins'][number]

/** 上游标准预设夹具（逐字副本 + 来源注释头，见 tests/fixtures/README 说明在文件头）。 */
const FIXTURE = new URL('./fixtures/upstream-standard.patch.yml', import.meta.url)

/**
 * `!!js` 标签 → loader 的 JsExpr 形状：与 `Entry.disabledOf` 读取的字段一致
 * （`{ __jsExpr: "<表达式源文本>" }`），因此深比较能验证门控表达式逐字相同。
 */
const JS_TAG: Tags[number] = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => ({ __jsExpr: String(value) }),
}

interface FixtureDeclaration {
  id: string
  name: string
  config: { id: string; order: number; plugins: Row[] }
}

/** 读夹具里 standard 预设的声明行列表。 */
function upstreamPlugins(): Row[] {
  const patch = parse(readFileSync(FIXTURE, 'utf8'), { customTags: [JS_TAG] }) as {
    insert: FixtureDeclaration[]
  }[]
  const declaration = patch[0]?.insert[0]
  assert.ok(declaration !== undefined, '夹具缺少预设声明行')
  assert.equal(declaration.name, '@deepseek-ai/dsh-agent-preset')
  assert.equal(declaration.config.id, 'standard')
  return declaration.config.plugins
}

/** 本包声明的行列表（默认配置）。 */
function leanPlugins(): Row[] {
  return [...leanPresetDefinition(Config({}) as Parameters<typeof leanPresetDefinition>[0]).plugins]
}

/** 深度优先展开组行（组自身在前、子行随后）。 */
function flatten(list: readonly Row[]): Row[] {
  const out: Row[] = []
  for (const row of list) {
    out.push(row)
    const children = row.group === true && Array.isArray(row.config) ? (row.config as Row[]) : []
    out.push(...flatten(children))
  }
  return out
}

/** 行 id → 行。 */
function byId(list: readonly Row[]): Map<string, Row> {
  return new Map(list.map((row) => [String(row.id), row]))
}

/** 平台门控表达式字符串。 */
function gating(row: Row | undefined): string | undefined {
  const disabled = row?.disabled as { __jsExpr?: string } | boolean | null | undefined
  return typeof disabled === 'object' && disabled !== null ? disabled.__jsExpr : undefined
}

test('Given 上游 standard 夹具 When 检查行来源 Then 本包只镜像上游已有的行', () => {
  const upstream = byId(flatten(upstreamPlugins()))
  const ours = flatten(leanPlugins())
  const invented = ours.map((row) => String(row.id)).filter((id) => !upstream.has(id))
  assert.deepEqual(invented, [], '声明了上游没有的行；新增能力须先上游存在')
})

test('Given 上游 standard 夹具 When 检查覆盖 Then 每个上游行要么被镜像、要么在去除清单', () => {
  const ours = byId(flatten(leanPlugins()))
  const dropped = new Set(DROPPED_ROWS)
  const undecided = flatten(upstreamPlugins())
    .map((row) => String(row.id))
    .filter((id) => !ours.has(id) && !dropped.has(id))
  assert.deepEqual(
    undecided,
    [],
    '上游新增/改名的行未决策：镜像进 definition.ts 或写进 DROPPED_ROWS',
  )
})

test('Given 去除清单 When 对照夹具 Then 每条都真实存在于上游', () => {
  const upstream = byId(flatten(upstreamPlugins()))
  const orphans = DROPPED_ROWS.filter((id) => !upstream.has(id))
  assert.deepEqual(orphans, [], '去除清单残留上游已不存在的行 id')
})

test('Given 被镜像的行 When 与夹具逐行深比较 Then name 与 config 完全一致', () => {
  const upstream = byId(flatten(upstreamPlugins()))
  for (const row of flatten(leanPlugins())) {
    const id = String(row.id)
    const source = upstream.get(id)
    assert.ok(source !== undefined, `上游缺少行 ${id}`)
    assert.equal(row.name, source.name, `行 ${id} 的 name 与上游不一致`)
    if (id === 'persona') continue // 自有 persona 文本：文本差异见下一条断言
    assert.deepStrictEqual(row, source, `行 ${id} 与上游不一致`)
  }
})

test('Given persona 行 When 与夹具比较 Then 只换前缀、其余字段沿用上游', () => {
  const upstream = byId(flatten(upstreamPlugins()))
  const source = upstream.get('persona')
  const ours = byId(flatten(leanPlugins())).get('persona')
  assert.ok(source !== undefined && ours !== undefined)
  const sourceConfig = source.config as Record<string, unknown>
  const ourConfig = ours.config as Record<string, unknown>
  assert.deepEqual(
    Object.keys(ourConfig).sort(),
    Object.keys(sourceConfig).sort(),
    'persona 行的配置字段集与上游不一致',
  )
  assert.notEqual(ourConfig.prefix, sourceConfig.prefix)
  for (const key of Object.keys(sourceConfig)) {
    if (key === 'prefix') continue
    assert.deepEqual(ourConfig[key], sourceConfig[key], `persona 行的 ${key} 与上游不一致`)
  }
})

test('Given shell 行 When 与夹具比较 Then 平台门控表达式逐字相同', () => {
  const upstream = byId(flatten(upstreamPlugins()))
  const ours = byId(flatten(leanPlugins()))
  for (const id of ['tool-bash', 'tool-pwsh']) {
    assert.equal(gating(ours.get(id)), gating(upstream.get(id)), `行 ${id} 的平台门控被改写`)
  }
})

test('Given 精简声明 When 对照夹具顺序 Then 行次序是上游次序的子序列', () => {
  const upstreamOrder = flatten(upstreamPlugins()).map((row) => String(row.id))
  const ours = flatten(leanPlugins()).map((row) => String(row.id))
  let cursor = 0
  for (const id of ours) {
    const at = upstreamOrder.indexOf(id, cursor)
    assert.ok(at >= 0, `行 ${id} 相对上游次序倒置`)
    cursor = at + 1
  }
})
