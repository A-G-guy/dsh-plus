/**
 * 查询层：用官方公开 api 的查询构造器（`api.q` / `api.aqlQuery`）取数与过滤，
 * 逐条对齐官方报表的 `makeQuery` 与 `make-filters-from-conditions` 用法。
 *
 * 只依赖公开面：`aqlQuery` 要求传**构造器对象**（其内部会 `serialize()`），因此这里
 * 不自己拼 AQL 字符串，避免与官方方言漂移。
 * @module @dsh-plus/actual-reports/query
 */

import type { ActualApiModule, QueryBuilder } from './api.ts'
import { weekFromDate } from './dates.ts'
import type { ReportCondition } from './model.ts'

export type { QueryBuilder }

/** 报表查询返回的一行（官方 `QueryDataEntity`）。 */
export interface RawReportRow {
  /** 区间键：月 `yyyy-MM`、年 `yyyy`、日/周 `yyyy-MM-dd`。 */
  date: string
  category: string | null
  categoryHidden: boolean
  categoryGroup: string
  categoryGroupHidden: boolean
  account: string
  accountOffBudget: boolean
  payee: string
  transferAccount: string
  amount: number
}

/** 取数依赖（api + handler 调用面）。 */
export interface BudgetDataDeps {
  api: ActualApiModule
  call(name: string, args?: unknown): Promise<unknown>
}

/** 原始行（AQL 结果按需取字段）。 */
export type RawRow = Record<string, unknown>

/** 预算基础数据：报表分组与实时区间都要用到。 */
export interface BudgetFacts {
  categories: RawRow[]
  categoryGroups: RawRow[]
  payees: RawRow[]
  accounts: RawRow[]
  /** 最早交易日期（无交易时回落为今天）。 */
  earliest: string
  /** 最晚交易日期（无交易时回落为今天）。 */
  latest: string
}

/** 区间分组表达式（官方 `makeQuery` 的 `intervalGroup`）。 */
export function intervalGroupExpr(interval: string): Record<string, string> {
  if (interval === 'Monthly') return { $month: '$date' }
  if (interval === 'Yearly') return { $year: '$date' }
  return { $day: '$date' }
}

/**
 * 区间过滤键（官方 `makeQuery` 的 `intervalFilter`）。
 * @throws 未知粒度时抛出（粒度已在模型层校验，这里再挡一次方言漂移）。
 */
export function intervalFilterKey(interval: string): string {
  switch (interval) {
    case 'Daily':
    case 'Weekly':
      return '$day'
    case 'Monthly':
      return '$month'
    case 'Yearly':
      return '$year'
    default:
      throw new Error(`未知的报表粒度：${JSON.stringify(interval)}`)
  }
}

/** 单侧（assets / debts）交易查询（官方 `makeQuery`）。 */
export function buildTransactionQuery(
  api: ActualApiModule,
  params: {
    name: 'assets' | 'debts'
    startDate: string
    endDate: string
    interval: string
    conditionsOpKey: '$and' | '$or'
    filters: unknown[]
  },
): QueryBuilder {
  const intervalGroup = intervalGroupExpr(params.interval)
  const intervalFilter = intervalFilterKey(params.interval)
  const query = api
    .q('transactions')
    .filter({ [params.conditionsOpKey]: params.filters })
    .filter({
      $and: [
        { date: { $transform: intervalFilter, $gte: params.startDate } },
        { date: { $transform: intervalFilter, $lte: params.endDate } },
      ],
    })
    .filter(params.name === 'assets' ? { amount: { $gt: 0 } } : { amount: { $lt: 0 } })
  return query
    .groupBy([
      intervalGroup,
      { $id: '$account' },
      { $id: '$payee' },
      { $id: '$category' },
      { $id: '$payee.transfer_acct.id' },
    ])
    .select([
      { date: intervalGroup },
      { category: { $id: '$category.id' } },
      { categoryHidden: { $id: '$category.hidden' } },
      { categoryGroup: { $id: '$category.group.id' } },
      { categoryGroupHidden: { $id: '$category.group.hidden' } },
      { account: { $id: '$account.id' } },
      { accountOffBudget: { $id: '$account.offbudget' } },
      { payee: { $id: '$payee.id' } },
      { transferAccount: { $id: '$payee.transfer_acct.id' } },
      { amount: { $sum: '$amount' } },
    ])
}

/** 跑一条 AQL 查询并取 `data`。 */
async function queryRows(api: ActualApiModule, builder: QueryBuilder): Promise<RawReportRow[]> {
  const result = await api.aqlQuery(builder)
  const data = (result as { data?: unknown }).data
  if (!Array.isArray(data)) {
    throw new Error(`查询未返回数据数组（实际：${JSON.stringify(result)?.slice(0, 200)}）`)
  }
  return data as RawReportRow[]
}

/**
 * 条件 → 官方过滤器表达式。
 *
 * 复用服务端 handler，保证与界面同一套语义（含自定义字段与转账特例）。
 * @throws handler 缺失或返回结构不符时抛出。
 */
export async function filtersForConditions(
  deps: BudgetDataDeps,
  conditions: ReportCondition[],
): Promise<unknown[]> {
  const usable = conditions.filter((condition) => condition.customName === undefined)
  const result = await deps.call('make-filters-from-conditions', { conditions: usable })
  const filters = (result as { filters?: unknown } | undefined)?.filters
  if (!Array.isArray(filters)) {
    throw new Error(
      '报表能力不可用：服务端 make-filters-from-conditions 未返回 filters 数组' +
        `（实际：${JSON.stringify(result)?.slice(0, 200)}）。请更新官方 CLI 后重试。`,
    )
  }
  return filters
}

/**
 * 取报表原始数据（assets / debts 两侧），周粒度按周首归并（官方同处理）。
 *
 * @throws 查询失败（含 handler 缺失）时原样上抛，由调用方补上下文。
 */
export async function fetchReportRows(
  deps: BudgetDataDeps,
  params: {
    startDate: string
    endDate: string
    interval: string
    conditionsOpKey: '$and' | '$or'
    filters: unknown[]
    firstDayOfWeekIdx?: string
  },
): Promise<{ assets: RawReportRow[]; debts: RawReportRow[] }> {
  const [assets, debts] = await Promise.all([
    queryRows(deps.api, buildTransactionQuery(deps.api, { ...params, name: 'assets' })),
    queryRows(deps.api, buildTransactionQuery(deps.api, { ...params, name: 'debts' })),
  ])
  if (params.interval !== 'Weekly') return { assets, debts }
  const toWeek = (row: RawReportRow): RawReportRow => ({
    ...row,
    date: weekFromDate(row.date, params.firstDayOfWeekIdx),
  })
  return { assets: assets.map(toWeek), debts: debts.map(toWeek) }
}

/** 读一张表的全部有效行（过滤 tombstone）。 */
async function tableRows(api: ActualApiModule, table: string): Promise<RawRow[]> {
  const rows = await api.aqlQuery(api.q(table).select(['*']))
  if (!Array.isArray(rows.data)) {
    throw new Error(`读取 ${table} 失败：查询未返回数据数组`)
  }
  return (rows.data as RawRow[]).filter((row) => row.tombstone !== 1)
}

/** 取交易日期端点（官方 `get-earliest-transaction` / `get-latest-transaction`）。 */
async function transactionBound(
  deps: BudgetDataDeps,
  handler: 'get-earliest-transaction' | 'get-latest-transaction',
  today: string,
): Promise<string> {
  const result = (await deps.call(handler)) as { date?: unknown } | undefined
  const date = result?.date
  return typeof date === 'string' && date !== '' ? date : today
}

/**
 * 读周首偏好（synced pref `firstDayOfWeekIdx`）。
 *
 * 官方界面把它存在预算的 `preferences` 表里；读不到返回 undefined（由调用方决定
 * 默认周首），读到了但取值非数字则显式报错——宁可报错也不悄悄换一套周界。
 * @throws 偏好值形态异常时抛出。
 */
export async function loadFirstDayOfWeek(
  deps: Pick<BudgetDataDeps, 'api'>,
): Promise<string | undefined> {
  const rows = await deps.api.aqlQuery(
    deps.api.q('preferences').filter({ id: 'firstDayOfWeekIdx' }).select(['*']),
  )
  const data = (rows as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) return undefined
  const value = (data[0] as RawRow).value
  if (typeof value === 'string') {
    if (!/^[0-6]$/.test(value)) {
      throw new Error(`预算的周首偏好取值异常：${JSON.stringify(value)}（期望 0-6）`)
    }
    return value
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6) {
    return String(value)
  }
  throw new Error(`预算的周首偏好取值异常：${JSON.stringify(value)}（期望 0-6）`)
}

/**
 * 载入报表所需的基础数据（分类、分组、收款人、账户）与交易日期端点。
 *
 * @param today - 无交易时端点回落到今天（官方行为）。
 */
export async function loadBudgetFacts(deps: BudgetDataDeps, today: string): Promise<BudgetFacts> {
  const [categories, categoryGroups, payees, accounts, earliest, latest] = await Promise.all([
    tableRows(deps.api, 'categories'),
    tableRows(deps.api, 'category_groups'),
    tableRows(deps.api, 'payees'),
    tableRows(deps.api, 'accounts'),
    transactionBound(deps, 'get-earliest-transaction', today),
    transactionBound(deps, 'get-latest-transaction', today),
  ])
  return { categories, categoryGroups, payees, accounts, earliest, latest }
}
