/**
 * 报表计算链路的行为测试：用已聚合的替身行验证过滤、聚合、去空行、裁剪、排序、
 * 图例与区间键，并断言发出的查询形状。
 * @module @dsh-plus/actual-reports/tests/compute
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeReport } from '../src/compute.ts'
import { normalizeReport } from '../src/model.ts'
import { buildTransactionQuery, fetchReportRows } from '../src/query.ts'
import { FakeQuery, fakeBudget } from './fixtures/fake-budget.ts'

/** 一个最小预算：两个分类（同组）、一个账户、一个收款人。 */
const FACTS = {
  categories: [
    { id: 'cat-food', name: 'Food', hidden: 0, group: 'grp-1', sort_order: 1 },
    { id: 'cat-rent', name: 'Rent', hidden: 0, group: 'grp-1', sort_order: 2 },
  ],
  categoryGroups: [{ id: 'grp-1', name: 'Living', hidden: 0, is_income: 0, sort_order: 1 }],
  payees: [{ id: 'pay-1', name: 'Shop', transfer_acct: null }],
  accounts: [{ id: 'acc-1', name: 'Checking', offbudget: 0 }],
  earliest: '2025-01-01',
  latest: '2025-02-28',
}

/** 两条月度数据：1 月只有 Food，2 月 Food 收入 + Rent 支出。 */
const ROWS = {
  assets: [
    {
      date: '2025-01',
      category: 'cat-food',
      categoryHidden: false,
      categoryGroup: 'grp-1',
      categoryGroupHidden: false,
      account: 'acc-1',
      accountOffBudget: false,
      payee: 'pay-1',
      transferAccount: null,
      amount: 10_000,
    },
    {
      date: '2025-02',
      category: 'cat-food',
      categoryHidden: false,
      categoryGroup: 'grp-1',
      categoryGroupHidden: false,
      account: 'acc-1',
      accountOffBudget: false,
      payee: 'pay-1',
      transferAccount: null,
      amount: 5_000,
    },
  ],
  debts: [
    {
      date: '2025-01',
      category: 'cat-food',
      categoryHidden: false,
      categoryGroup: 'grp-1',
      categoryGroupHidden: false,
      account: 'acc-1',
      accountOffBudget: false,
      payee: 'pay-1',
      transferAccount: null,
      amount: -3_000,
    },
    {
      date: '2025-02',
      category: 'cat-rent',
      categoryHidden: false,
      categoryGroup: 'grp-1',
      categoryGroupHidden: false,
      account: 'acc-1',
      accountOffBudget: false,
      payee: 'pay-1',
      transferAccount: null,
      amount: -7_000,
    },
  ],
}

/** 固定定义的报表（静态区间，按分类分组，口径 Payment）。 */
function definitionOf(overrides: Record<string, unknown> = {}): ReturnType<typeof normalizeReport> {
  return normalizeReport(
    {
      name: '测试报表',
      isDateStatic: true,
      startDate: '2025-01-01',
      endDate: '2025-02-28',
      interval: 'Monthly',
      groupBy: 'Category',
      balanceType: 'Payment',
      sortBy: 'desc',
      showEmpty: false,
      ...overrides,
    },
    { today: '2025-03-15', requireName: true },
  )
}

/** 跑一次计算。 */
async function compute(fixture = fakeBudget({ ...FACTS, ...ROWS }), overrides = {}) {
  return await computeReport({
    definition: definitionOf(overrides),
    today: '2025-03-15',
    deps: { api: fixture.api, call: fixture.call },
  })
}

test('按分类聚合：系列合计、逐区间明细与总计', async () => {
  const data = await compute()
  assert.equal(data.startDate, '2025-01-01')
  assert.equal(data.endDate, '2025-02-28')
  assert.deepEqual(data.intervals, ['2025-01', '2025-02'])

  const food = data.data.find((item) => item.id === 'cat-food')
  assert.ok(food)
  assert.equal(food.totalAssets, 15_000)
  assert.equal(food.totalDebts, -3_000)
  assert.equal(food.totalTotals, 12_000)
  assert.deepEqual(
    food.intervalData.map((item) => [item.key, item.totalAssets, item.totalDebts, item.change]),
    [
      ['2025-01', 10_000, -3_000, 0],
      ['2025-02', 5_000, 0, 5_000 - 7_000],
    ],
  )

  const rent = data.data.find((item) => item.id === 'cat-rent')
  assert.ok(rent)
  assert.equal(rent.totalTotals, -7_000)

  assert.deepEqual(
    data.intervalData.map((item) => [
      item.key,
      item.totalAssets,
      item.totalDebts,
      item.totalTotals,
    ]),
    [
      ['2025-01', 10_000, -3_000, 7_000],
      ['2025-02', 5_000, -7_000, -2_000],
    ],
  )
  // 官方把每个系列（含空系列与虚拟项）都写进 stacked，故 series 会带 0 值键。
  assert.deepEqual(data.intervalData[1]?.series, {
    'cat-food': 0,
    'cat-rent': 7_000,
    Uncategorized: 0,
    'Off budget': 0,
    Transfers: 0,
  })
  assert.deepEqual(
    {
      assets: data.totalAssets,
      debts: data.totalDebts,
      netAssets: data.netAssets,
      netDebts: data.netDebts,
      totals: data.totalTotals,
    },
    { assets: 15_000, debts: -10_000, netAssets: 7_000, netDebts: -2_000, totals: 5_000 },
  )
})

test('空系列按口径剔除，showEmpty 时保留虚拟项', async () => {
  const data = await compute()
  assert.deepEqual(
    data.data.map((item) => item.id),
    ['cat-rent', 'cat-food'],
  )
  assert.deepEqual(
    data.legend.map((item) => item.name),
    ['Rent', 'Food'],
  )

  const withEmpty = await compute(undefined, { showEmpty: true })
  assert.deepEqual(
    withEmpty.data.map((item) => item.name),
    ['Rent', 'Food', 'Uncategorized', 'Off budget', 'Transfers'],
  )
})

test('trimIntervals 裁掉首尾空区间（含分组明细）', async () => {
  const data = await compute(undefined, {
    startDate: '2024-12-01',
    endDate: '2025-02-28',
    trimIntervals: true,
  })
  assert.deepEqual(data.intervals, ['2024-12', '2025-01', '2025-02'])
  assert.deepEqual(
    data.intervalData.map((item) => item.key),
    ['2025-01', '2025-02'],
  )
  const food = data.data.find((item) => item.id === 'cat-food')
  assert.deepEqual(
    food?.intervalData.map((item) => item.key),
    ['2025-01', '2025-02'],
  )
})

test('隐藏分类与预算外账户按开关过滤', async () => {
  const fixture = fakeBudget({
    ...FACTS,
    assets: [],
    debts: [
      { ...ROWS.debts[0], categoryHidden: true },
      { ...ROWS.debts[1], accountOffBudget: true, account: 'acc-2' },
    ],
  })
  // 官方默认 showHiddenCategories=true（默认展示隐藏分类），故显式关掉它才有「两行都不算」。
  const filtered = await computeReport({
    definition: definitionOf({ showHiddenCategories: false, showOffBudget: false }),
    today: '2025-03-15',
    deps: { api: fixture.api, call: fixture.call },
  })
  assert.deepEqual(filtered.data, [])
  assert.equal(filtered.totalDebts, 0)

  const shown = await computeReport({
    definition: definitionOf({ showHiddenCategories: true, showOffBudget: true }),
    today: '2025-03-15',
    deps: { api: fixture.api, call: fixture.call },
  })
  assert.equal(shown.totalDebts, -10_000)
  // 预算外账户的行归到虚拟系列「Off budget」，而不是它实际所属的分类。
  assert.equal(shown.data.find((item) => item.name === 'Off budget')?.totalDebts, -7_000)
  assert.equal(shown.data.find((item) => item.id === 'cat-food')?.totalDebts, -3_000)
})

test('实时区间报表用最早/最晚交易端点', async () => {
  const fixture = fakeBudget({ ...FACTS, ...ROWS })
  const data = await computeReport({
    definition: definitionOf({ isDateStatic: false, dateRange: 'This month' }),
    today: '2025-03-15',
    deps: { api: fixture.api, call: fixture.call },
  })
  assert.equal(data.startDate, '2025-03-01')
  assert.equal(data.endDate, '2025-03-31')
  assert.ok(fixture.calls.some((item) => item.name === 'get-earliest-transaction'))
})

test('查询形状与官方一致：区间转换、条件运算与分组字段', async () => {
  const fixture = fakeBudget()
  const builder = buildTransactionQuery(fixture.api, {
    name: 'assets',
    startDate: '2025-01-01',
    endDate: '2025-02-28',
    interval: 'Monthly',
    conditionsOpKey: '$and',
    filters: [{ id: 'f1' }],
  })
  assert.ok(builder instanceof FakeQuery)
  assert.deepEqual(builder.filters, [
    { $and: [{ id: 'f1' }] },
    {
      $and: [
        { date: { $transform: '$month', $gte: '2025-01-01' } },
        { date: { $transform: '$month', $lte: '2025-02-28' } },
      ],
    },
    { amount: { $gt: 0 } },
  ])
  assert.deepEqual(builder.groupByFields[0], { $month: '$date' })
  assert.deepEqual(builder.selectedFields.at(-1), { amount: { $sum: '$amount' } })
})

test('周粒度按周首归并行日期', async () => {
  const fixture = fakeBudget({
    assets: [],
    debts: [
      { ...ROWS.debts[0], date: '2025-01-08' },
      { ...ROWS.debts[1], date: '2025-01-10' },
    ],
  })
  const rows = await fetchReportRows(
    { api: fixture.api, call: fixture.call },
    {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      interval: 'Weekly',
      conditionsOpKey: '$and',
      filters: [],
      firstDayOfWeekIdx: '1',
    },
  )
  assert.deepEqual(
    rows.debts.map((row) => row.date),
    ['2025-01-06', '2025-01-06'],
  )
})

test('未支持的旋钮当场报错', async () => {
  await assert.rejects(
    async () => await compute(undefined, { balanceType: 'Budgeted' }),
    /balanceType=Budgeted（预算口径）暂不支持/,
  )
  const tag = normalizeReport(
    { name: 'x', groupBy: 'Tag', conditionsOp: 'and' },
    { today: '2025-03-15', requireName: true },
  )
  await assert.rejects(
    async () =>
      await computeReport({
        definition: tag,
        today: '2025-03-15',
        deps: { api: fakeBudget().api, call: fakeBudget().call },
      }),
    /groupBy=Tag（标签分组）暂不支持/,
  )
})
