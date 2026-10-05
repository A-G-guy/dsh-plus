/**
 * 报表计算入口：解析区间 → 取维度 → 取数 → 交给 `aggregate.ts` 聚合。
 * @module @dsh-plus/actual-reports/compute
 */

import {
  buildGroupEntry,
  buildIntervalData,
  buildLegend,
  compareGroups,
  determineIntervalRange,
  type FilterOptions,
  type GroupEntry,
  type IntervalEntry,
  keepRow,
  type LegendEntry,
  trimGroupIntervals,
  trimIntervalData,
} from './aggregate.ts'
import { selectGroups } from './groups.ts'
import { intervalRangeOf } from './interval-range.ts'
import { assertComputable, balanceOpOf, type ReportDefinition } from './model.ts'
import {
  type BudgetDataDeps,
  type BudgetFacts,
  fetchReportRows,
  filtersForConditions,
  loadBudgetFacts,
} from './query.ts'
import { getLiveRange } from './report-ranges.ts'

/** 计算结果。 */
export interface ReportData {
  definition: ReportDefinition
  startDate: string
  endDate: string
  /** 区间键序列（与 `intervalData` 一一对应，便于机器处理）。 */
  intervals: string[]
  data: GroupEntry[]
  intervalData: IntervalEntry[]
  legend: LegendEntry[]
  totalAssets: number
  totalDebts: number
  netAssets: number
  netDebts: number
  totalTotals: number
}

/** 计算所需的依赖与参数。 */
export interface ComputeReportInput {
  definition: ReportDefinition
  /** 今天（`yyyy-MM-dd`），实时区间与默认区间用。 */
  today: string
  firstDayOfWeekIdx?: string
  deps: BudgetDataDeps
}

/**
 * 计算一张报表。
 *
 * @throws 定义不可计算（未支持的旋钮）、维度无系列、handler 缺失、查询失败时抛出。
 */
export async function computeReport(input: ComputeReportInput): Promise<ReportData> {
  const { definition, today, deps } = input
  assertComputable(definition)
  const facts: BudgetFacts = await loadBudgetFacts(deps, today)
  const [startDate, endDate] = resolveRange(definition, facts, today, input.firstDayOfWeekIdx)
  const selection = selectGroups(definition.groupBy, facts)
  if (selection.items.length === 0) {
    throw new Error(
      `groupBy=${definition.groupBy} 下没有任何可用的分组项：请检查预算里是否已有分类/收款人/账户。`,
    )
  }
  const filters = await filtersForConditions(deps, definition.conditions)
  const { assets, debts } = await fetchReportRows(deps, {
    startDate,
    endDate,
    interval: definition.interval,
    conditionsOpKey: definition.conditionsOp === 'or' ? '$or' : '$and',
    filters,
    ...(input.firstDayOfWeekIdx === undefined
      ? {}
      : { firstDayOfWeekIdx: input.firstDayOfWeekIdx }),
  })
  const intervals = intervalRangeOf(
    definition.interval,
    startDate,
    endDate,
    input.firstDayOfWeekIdx,
  )
  const options: FilterOptions = {
    showOffBudget: definition.showOffBudget,
    showHiddenCategories: definition.showHiddenCategories,
    showUncategorized: definition.showUncategorized,
  }
  const op = balanceOpOf(definition)
  const aggregated = buildIntervalData({
    intervals,
    items: selection.items,
    assets,
    debts,
    label: selection.label,
    options,
    op,
    interval: definition.interval,
    startDate,
    endDate,
  })
  const groups = selection.items.map((item) =>
    buildGroupEntry({
      item,
      intervals,
      assets,
      debts,
      label: selection.label,
      options,
      startDate,
      endDate,
    }),
  )
  const visible = groups.filter((entry) => keepRow(entry, definition.showEmpty, op))
  const { startIndex, endIndex } = determineIntervalRange(
    visible,
    aggregated.intervalData,
    definition.trimIntervals,
    op,
  )
  const intervalData = definition.trimIntervals
    ? trimIntervalData(aggregated.intervalData, startIndex, endIndex)
    : aggregated.intervalData
  if (definition.trimIntervals) trimGroupIntervals(visible, startIndex, endIndex)
  const sorted = [...visible].sort(compareGroups(op, definition.sortBy))
  return {
    definition,
    startDate,
    endDate,
    intervals,
    data: sorted,
    intervalData,
    legend: buildLegend(intervalData, sorted, definition.groupBy),
    totalAssets: aggregated.totalAssets,
    totalDebts: aggregated.totalDebts,
    netAssets: aggregated.netAssets,
    netDebts: aggregated.netDebts,
    totalTotals: aggregated.totalAssets + aggregated.totalDebts,
  }
}

/** 起止日期：静态定义直接用定义值，实时区间走官方区间解析。 */
export function resolveRange(
  definition: ReportDefinition,
  facts: Pick<BudgetFacts, 'earliest' | 'latest'>,
  today: string,
  firstDayOfWeekIdx?: string,
): [string, string] {
  if (definition.isDateStatic) return [definition.startDate, definition.endDate]
  return getLiveRange(
    definition.dateRange,
    facts.earliest,
    facts.latest,
    definition.includeCurrentInterval,
    {
      today,
      ...(firstDayOfWeekIdx === undefined ? {} : { firstDayOfWeekIdx }),
    },
  )
}
