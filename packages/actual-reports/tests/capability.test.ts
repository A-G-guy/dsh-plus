/**
 * 能力描述符的行为测试：schema 与动作表同源、json 选项是对象、执行计划可喂给 argv 构造。
 * @module @dsh-plus/actual-reports/tests/capability
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DASHBOARD_FAMILY, FAMILIES, REFERENCE_FAMILY, REPORT_FAMILY } from '../src/actions.ts'
import { ACTION_NAMES, FAMILY_CAPABILITIES, findCapability } from '../src/capability.ts'
import { runnerOf } from '../src/cli.ts'

test('报表族能力：名字、只读标记与执行计划', () => {
  const capability = findCapability('report')
  assert.ok(capability)
  assert.equal(capability.readOnly, false, '含写动作的族不能标为整工具只读')
  assert.equal(capability.source, 'cli')
  assert.equal(capability.reports.family, 'report')
  assert.deepEqual(
    capability.reports.actions.map((item) => item.action),
    ACTION_NAMES(REPORT_FAMILY),
  )
  assert.equal(findCapability('nope'), undefined)
  assert.deepEqual(
    FAMILY_CAPABILITIES.map((item) => item.name),
    FAMILIES.map((item) => item.family),
  )
  assert.deepEqual(
    FAMILY_CAPABILITIES.map((item) => item.name),
    ['report', 'dashboard', 'reference'],
  )
})

test('参考族能力：全只读、不打开预算、schema 与动作表同源', () => {
  const capability = findCapability('reference')
  assert.ok(capability)
  assert.equal(capability.readOnly, true, '参考族只读')
  assert.deepEqual(
    capability.reports.actions.map((item) => item.action),
    ACTION_NAMES(REFERENCE_FAMILY),
  )
  for (const action of REFERENCE_FAMILY.actions) {
    assert.equal(action.readOnly, true, `${action.action} 应为只读`)
  }
  const skipBudget = REFERENCE_FAMILY.actions
    .filter((item) => item.needsBudget === false)
    .map((item) => item.action)
  assert.deepEqual(
    skipBudget,
    ['widgets', 'source', 'report-options'],
    '只有要读偏好表的动作才开预算',
  )
  const properties = capability.inputSchema.properties as Record<string, Record<string, unknown>>
  assert.deepEqual(properties.action?.enum, ACTION_NAMES(REFERENCE_FAMILY))
  assert.equal(properties.verify?.type, 'boolean')
  assert.equal(properties.grep?.type, 'string')
  assert.deepEqual(capability.inputSchema.required, ['action'])
})

test('仪表盘族能力：动作表、只读标记与执行器接线齐备', () => {
  const capability = findCapability('dashboard')
  assert.ok(capability)
  assert.equal(capability.readOnly, false)
  assert.deepEqual(
    capability.reports.actions.map((item) => item.action),
    ACTION_NAMES(DASHBOARD_FAMILY),
  )
  const readOnly = capability.reports.actions
    .filter((item) => item.readOnly)
    .map((item) => item.action)
  assert.deepEqual(readOnly, ['list', 'widgets'], '只有读取动作可以免审批')
  for (const family of FAMILIES) {
    assert.equal(typeof runnerOf(family.family), 'function', `族 ${family.family} 未接执行器`)
    assert.equal(family.guidance.length > 0, true, `族 ${family.family} 缺少模型面建议`)
  }
  assert.throws(() => runnerOf('nope'), /没有对应的动作执行器/)
})

test('并集 schema：action 枚举 + 各动作参数的 JSON 类型', () => {
  const capability = findCapability('report')
  assert.ok(capability)
  const properties = capability.inputSchema.properties as Record<string, Record<string, unknown>>
  assert.deepEqual(properties.action?.enum, ACTION_NAMES(REPORT_FAMILY))
  assert.equal(properties.definition?.type, 'object')
  assert.equal(properties.overrides?.type, 'object')
  assert.equal(properties.force?.type, 'boolean')
  assert.equal(properties.reportId?.type, 'string')
  assert.equal(properties.today?.type, 'string')
  assert.deepEqual(capability.inputSchema.required, ['action'])
  assert.equal(capability.inputSchema.additionalProperties, false)

  const expected = new Set(
    REPORT_FAMILY.actions.flatMap((action) => action.args.map((spec) => spec.prop)),
  )
  expected.add('action')
  assert.deepEqual(new Set(Object.keys(properties)), expected)
})

test('执行计划逐条对齐选项表（含必填与 flag 名）', () => {
  const capability = findCapability('report')
  assert.ok(capability)
  const plans = capability.reports.actions
  for (const action of REPORT_FAMILY.actions) {
    const matched = plans.filter((item) => item.action === action.action)
    assert.equal(matched.length, 1)
    assert.deepEqual(
      matched[0]?.args,
      action.args.map((spec) => ({
        prop: spec.prop,
        flag: spec.flag,
        type: spec.type,
        required: spec.required === true,
      })),
    )
    assert.equal(matched[0]?.readOnly, action.readOnly)
  }
  const create = plans.filter((item) => item.action === 'create')
  assert.equal(create[0]?.args[0]?.required, true)
})
