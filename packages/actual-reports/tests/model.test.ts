/**
 * 报表定义模型的行为测试：默认值、白名单、别名归一、条件清洗与只读映射。
 * @module @dsh-plus/actual-reports/tests/model
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertComputable, balanceOpOf, fromModel, normalizeReport } from '../src/model.ts'

const TODAY = '2025-03-15'

test('缺省字段回落官方默认值（含随今天计算的起止日期）', () => {
  const definition = normalizeReport({ name: '默认报表' }, { today: TODAY, requireName: true })
  assert.equal(definition.startDate, '2024-10-01')
  assert.equal(definition.endDate, '2025-03-15')
  assert.equal(definition.dateRange, 'Last 6 months')
  assert.equal(definition.interval, 'Monthly')
  assert.equal(definition.groupBy, 'Category')
  assert.equal(definition.balanceType, 'Payment')
  assert.equal(definition.sortBy, 'desc')
  assert.equal(definition.showHiddenCategories, true)
  assert.equal(definition.includeCurrentInterval, true)
  assert.equal(definition.conditionsOp, 'and')
})

test('name 必填与类型校验', () => {
  assert.throws(() => normalizeReport({}, { today: TODAY, requireName: true }), /name 必填/)
  assert.doesNotThrow(() => normalizeReport({}, { today: TODAY, requireName: false }))
  assert.throws(
    () => normalizeReport({ name: 'x', showEmpty: 'yes' }, { today: TODAY, requireName: true }),
    /showEmpty 必须是布尔值/,
  )
})

test('白名单取值与界面标签别名', () => {
  assert.equal(
    normalizeReport({ name: 'x', sortBy: 'Descending' }, { today: TODAY, requireName: true })
      .sortBy,
    'desc',
  )
  assert.equal(
    normalizeReport({ name: 'x', sortBy: 'asc' }, { today: TODAY, requireName: true }).sortBy,
    'asc',
  )
  assert.throws(
    () => normalizeReport({ name: 'x', interval: 'Hourly' }, { today: TODAY, requireName: true }),
    /interval = "Hourly"，合法取值：Daily \/ Weekly \/ Monthly \/ Yearly/,
  )
  assert.throws(
    () =>
      normalizeReport({ name: 'x', balanceType: 'Expense' }, { today: TODAY, requireName: true }),
    /balanceType = "Expense"/,
  )
  assert.throws(
    () =>
      normalizeReport(
        { name: 'x', isDateStatic: false, dateRange: 'Yesterday' },
        { today: TODAY, requireName: true },
      ),
    /dateRange = "Yesterday"/,
  )
})

test('conditions 清洗：丢弃界面临时态、结构不符即报错', () => {
  const definition = normalizeReport(
    {
      name: 'x',
      conditions: [
        { field: 'category', op: 'is', value: 'cat-1' },
        { field: 'payee', op: 'is', value: 'pay-1', customName: 'tmp' },
      ],
    },
    { today: TODAY, requireName: true },
  )
  assert.deepEqual(definition.conditions, [{ field: 'category', op: 'is', value: 'cat-1' }])
  assert.throws(
    () =>
      normalizeReport(
        { name: 'x', conditions: [{ value: 1 }] },
        { today: TODAY, requireName: true },
      ),
    /conditions\[0\] 需要 field 与 op 字符串/,
  )
})

test('v1 未支持的旋钮有专属错误文案', () => {
  const budgeted = normalizeReport(
    { name: 'x', balanceType: 'Budgeted' },
    { today: TODAY, requireName: true },
  )
  assert.throws(() => assertComputable(budgeted), /balanceType=Budgeted（预算口径）暂不支持/)
  const tag = normalizeReport({ name: 'x', groupBy: 'Tag' }, { today: TODAY, requireName: true })
  assert.throws(() => assertComputable(tag), /groupBy=Tag（标签分组）暂不支持/)
  assert.equal(
    balanceOpOf(normalizeReport({ name: 'x' }, { today: TODAY, requireName: true })),
    'totalDebts',
  )
})

test('官方 report/get 的模型原样透传（不认得的取值不在读取侧拒绝）', () => {
  const definition = fromModel({
    id: 'rep-1',
    name: '界面报表',
    startDate: '2024-01-01',
    endDate: '2024-06-30',
    isDateStatic: true,
    dateRange: 'Last 6 months',
    mode: 'time',
    groupBy: 'Payee',
    sortBy: 'name',
    interval: 'Weekly',
    balanceType: 'Net Payment',
    showEmpty: true,
    showOffBudget: true,
    showHiddenCategories: false,
    showUncategorized: false,
    trimIntervals: true,
    showTrendLines: true,
    includeCurrentInterval: false,
    graphType: 'DonutGraph',
    conditions: [{ field: 'account', op: 'is', value: 'acc-1' }],
    conditionsOp: 'or',
    metadata: { marker: 1 },
  })
  assert.equal(definition.id, 'rep-1')
  assert.equal(definition.balanceType, 'Net Payment')
  assert.equal(definition.sortBy, 'name')
  assert.equal(definition.conditionsOp, 'or')
  assert.deepEqual(definition.metadata, { marker: 1 })

  const unknown = fromModel({ name: 'x', groupBy: 'SomethingNew', balanceType: 'Whatever' })
  assert.equal(unknown.groupBy, 'SomethingNew')
  assert.equal(unknown.balanceType, 'Whatever')
})
