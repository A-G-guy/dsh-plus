/**
 * 报表聚合：官方 `createCustomSpreadsheet` 里「取数之后」的全部口径——按系列与区间
 * 聚合、去空行、裁剪区间、排序、图例。
 *
 * 与官方逐条对齐的算法要点（改动任何一条都会算出与界面不同的数）：
 * - 系列命中条件是「该行的分组键 === 系列 id」，虚拟项（未分类/转账/预算外）另按归集规则参与；
 * - 区间合计是对各系列金额求和（不是对原始交易求和），金额单位是分；
 * - `Net` / `Net Payment` / `Net Deposit` 的正负拆分与官方一致（负债取绝对值）；
 * - `totalBudgeted` 在非预算口径下等于合计（官方同款冗余字段，保留以对齐形状）。
 *
 * 相对官方 `DataEntity` 的两处**有意的结构差异**（对外 JSON 更好用，数值不变）：
 * - 系列金额收在 `series` 子对象里，而不是摊在区间对象顶层；
 * - 每个区间条目带原始区间键 `key`（官方只有展示用 `date` 标签）。
 * @module @dsh-plus/actual-reports/aggregate
 */

import type { GroupItem } from './groups.ts'
import type { BalanceOp } from './model.ts'
import type { RawReportRow } from './query.ts'

/** 过滤开关。 */
export interface FilterOptions {
  showOffBudget: boolean
  showHiddenCategories: boolean
  showUncategorized: boolean
}

/** 一个区间的聚合结果。 */
export interface IntervalEntry {
  /** 原始区间键（`yyyy-MM` / `yyyy` / `yyyy-MM-dd`）。 */
  key: string
  /** 官方展示标签（如 `Sep '24`），仅用于展示。 */
  date: string
  intervalStartDate: string
  intervalEndDate: string
  totalAssets: number
  totalDebts: number
  netAssets: number
  netDebts: number
  totalTotals: number
  /** 预算口径合计（非预算口径下等于 totalTotals，官方同款冗余字段）。 */
  totalBudgeted: number
  /** 各系列在该区间的金额，键 = 系列 id（无 id 时用名称）。 */
  series: Record<string, number>
}

/** 分组区间明细（分组维度下的时间序列）。 */
export interface GroupIntervalEntry {
  key: string
  intervalStartDate: string
  intervalEndDate: string
  totalAssets: number
  totalDebts: number
  netAssets: number
  netDebts: number
  totalTotals: number
  totalBudgeted: number
  /** 与上一个区间的合计差（官方 `change`）。 */
  change: number
}

/** 一个系列（分组）的合计与时间序列。 */
export interface GroupEntry {
  id: string
  name: string
  uncategorizedId?: string
  totalAssets: number
  totalDebts: number
  netAssets: number
  netDebts: number
  totalTotals: number
  totalBudgeted: number
  intervalData: GroupIntervalEntry[]
}

/** 图例项。 */
export interface LegendEntry {
  id: string
  name: string
  dataKey: string
  uncategorizedId?: string
}

/** 官方 `filterReportTransactions`：按隐藏/预算外/未分类开关过滤原始行。 */
export function filterReportTransactions(
  rows: RawReportRow[],
  options: FilterOptions,
): RawReportRow[] {
  return rows
    .filter(
      (row) =>
        options.showHiddenCategories ||
        (row.categoryHidden === false && row.categoryGroupHidden === false),
    )
    .filter((row) => options.showOffBudget || row.accountOffBudget === false)
    .filter(
      (row) => options.showUncategorized || row.category !== null || row.accountOffBudget === true,
    )
}

/** 官方 `filterHiddenItems`：再加上「行属于哪个系列」的归集规则。 */
export function filterGroupRows(
  item: GroupItem,
  rows: RawReportRow[],
  options: FilterOptions,
  groupByCategory: boolean,
): RawReportRow[] {
  return filterReportTransactions(rows, options).filter((row) => {
    if (!groupByCategory) return true
    const hasCategory = Boolean(row.category)
    const isOffBudget = row.accountOffBudget
    const isTransfer = Boolean(row.transferAccount)
    if (hasCategory && !isOffBudget) return item.uncategorizedId === undefined
    switch (item.uncategorizedId) {
      case 'off_budget':
        return isOffBudget
      case 'transfer':
        return isTransfer && !isOffBudget
      case 'other':
        return !isOffBudget && !isTransfer
      case 'all':
        return true
      default:
        return false
    }
  })
}

/** 某系列在某区间的金额之和（官方 `recalculate` / 区间循环里的同一表达式）。 */
function sumForSeries(
  item: GroupItem,
  rows: RawReportRow[],
  groupByLabel: string,
  intervalKey: string,
  options: FilterOptions,
  groupByCategory: boolean,
): number {
  const key = item.id === '' ? null : item.id
  return filterGroupRows(item, rows, options, groupByCategory)
    .filter(
      (row) =>
        row.date === intervalKey &&
        ((row as unknown as Record<string, unknown>)[groupByLabel] === key ||
          (item.uncategorizedId !== undefined && groupByCategory)),
    )
    .reduce((total, row) => total + row.amount, 0)
}

/** 系列键（官方 `item.id || item.name`）。 */
function seriesKeyOf(item: GroupItem): string {
  return item.id === '' ? item.name : item.id
}

/** 官方 `filterEmptyRows`：是否保留该系列。 */
export function keepRow(entry: GroupEntry, showEmpty: boolean, op: BalanceOp): boolean {
  if (showEmpty) return true
  if (op === 'totalTotals') {
    return entry.totalDebts !== 0 || entry.totalAssets !== 0 || entry.totalTotals !== 0
  }
  return entry[op] !== 0
}

/** 官方 `sortData`：按口径排序（负债类口径反向，Budget 视为等序）。 */
export function compareGroups(
  op: BalanceOp,
  sortBy: string,
): (a: GroupEntry, b: GroupEntry) => number {
  const reverse: Record<string, string> = { asc: 'desc', desc: 'asc' }
  const effective = op === 'totalDebts' || op === 'netDebts' ? (reverse[sortBy] ?? sortBy) : sortBy
  return (a, b) => {
    if (effective === 'asc') return a[op] - b[op]
    if (effective === 'desc') return b[op] - a[op]
    if (effective === 'name') return a.name.localeCompare(b.name)
    return 0
  }
}

/** 官方 `isEmptyForMetric`。 */
function isEmptyForMetric(interval: IntervalEntry, op: BalanceOp): boolean {
  return interval[op] === 0
}

/** 官方 `determineIntervalRange`：裁剪后要保留的区间下标区间。 */
export function determineIntervalRange(
  data: GroupEntry[],
  intervalData: IntervalEntry[],
  trim: boolean,
  op: BalanceOp,
): { startIndex: number; endIndex: number } {
  if (!trim || intervalData.length === 0) {
    return { startIndex: 0, endIndex: intervalData.length - 1 }
  }
  let start = intervalData.length
  let end = -1
  for (const item of data) {
    const first = item.intervalData.findIndex((entry) => !isEmptyForMetric(intervalOf(entry), op))
    if (first === -1) continue
    start = Math.min(start, first)
    let last = item.intervalData.length - 1
    while (
      last >= 0 &&
      isEmptyForMetric(intervalOf(item.intervalData[last] as GroupIntervalEntry), op)
    ) {
      last -= 1
    }
    end = Math.max(end, last)
  }
  const mainFirst = intervalData.findIndex((entry) => !isEmptyForMetric(entry, op))
  if (mainFirst !== -1) {
    start = Math.min(start, mainFirst)
    let mainLast = intervalData.length - 1
    while (mainLast >= 0 && isEmptyForMetric(intervalData[mainLast] as IntervalEntry, op)) {
      mainLast -= 1
    }
    end = Math.max(end, mainLast)
  }
  if (start === intervalData.length || end === -1) return { startIndex: 0, endIndex: -1 }
  return { startIndex: start, endIndex: end }
}

/** 把分组区间明细当区间条目看（只为复用官方那套「是否为空」判断）。 */
function intervalOf(entry: GroupIntervalEntry): IntervalEntry {
  return { ...entry, date: entry.key, series: {} }
}

/** 区间裁剪（官方 `trimIntervalDataToRange`）。 */
export function trimIntervalData(
  data: IntervalEntry[],
  startIndex: number,
  endIndex: number,
): IntervalEntry[] {
  if (startIndex > endIndex || startIndex < 0 || endIndex >= data.length) return []
  return data.slice(startIndex, endIndex + 1)
}

/** 分组区间裁剪（官方 `trimIntervalsToRange`）。 */
export function trimGroupIntervals(data: GroupEntry[], startIndex: number, endIndex: number): void {
  for (const item of data) {
    item.intervalData =
      startIndex > endIndex || startIndex < 0 || endIndex >= item.intervalData.length
        ? []
        : item.intervalData.slice(startIndex, endIndex + 1)
  }
}

/** 图例（官方 `calculateLegend`，去掉纯展示用的配色）。 */
export function buildLegend(
  intervalData: IntervalEntry[],
  data: GroupEntry[],
  groupBy: string,
): LegendEntry[] {
  if (groupBy === 'Interval') {
    return intervalData.map((entry) => ({ id: '', name: entry.date, dataKey: entry.date }))
  }
  return data.map((entry) => {
    const legend: LegendEntry = {
      id: entry.id,
      name: entry.name,
      dataKey: entry.id === '' ? entry.name : entry.id,
    }
    if (entry.uncategorizedId !== undefined) legend.uncategorizedId = entry.uncategorizedId
    return legend
  })
}

/** 单侧金额之和。 */
function sumRows(
  item: GroupItem,
  rows: RawReportRow[],
  label: string,
  intervalKey: string,
  options: FilterOptions,
  groupByCategory: boolean,
): number {
  return sumForSeries(item, rows, label, intervalKey, options, groupByCategory)
}

/** 计算区间级聚合。 */
export function buildIntervalData(input: {
  intervals: string[]
  items: GroupItem[]
  assets: RawReportRow[]
  debts: RawReportRow[]
  label: string
  options: FilterOptions
  op: BalanceOp
  interval: string
  startDate: string
  endDate: string
}): {
  intervalData: IntervalEntry[]
  totalAssets: number
  totalDebts: number
  netAssets: number
  netDebts: number
} {
  const groupByCategory = input.label === 'category' || input.label === 'categoryGroup'
  let totalAssets = 0
  let totalDebts = 0
  let netAssets = 0
  let netDebts = 0
  const intervalData = input.intervals.map((intervalKey, index) => {
    const series: Record<string, number> = {}
    let perAssets = 0
    let perDebts = 0
    let perTotals = 0
    for (const item of input.items) {
      const intervalAssets = sumRows(
        item,
        input.assets,
        input.label,
        intervalKey,
        input.options,
        groupByCategory,
      )
      const intervalDebts = sumRows(
        item,
        input.debts,
        input.label,
        intervalKey,
        input.options,
        groupByCategory,
      )
      perAssets += intervalAssets
      perDebts += intervalDebts
      const net = intervalAssets + intervalDebts
      let stacked = 0
      if (input.op === 'totalAssets') stacked += intervalAssets
      if (input.op === 'totalDebts') stacked += Math.abs(intervalDebts)
      if (input.op === 'netAssets') stacked += net > 0 ? net : 0
      if (input.op === 'netDebts') stacked = net < 0 ? Math.abs(net) : 0
      if (input.op === 'totalTotals') stacked += net
      series[seriesKeyOf(item)] = stacked
      perTotals += net
    }
    totalAssets += perAssets
    totalDebts += perDebts
    netAssets += perTotals > 0 ? perTotals : 0
    netDebts += perTotals < 0 ? perTotals : 0
    return {
      key: intervalKey,
      date: intervalLabel(input.interval, intervalKey),
      intervalStartDate: index === 0 ? input.startDate : intervalKey,
      intervalEndDate:
        index + 1 === input.intervals.length
          ? input.endDate
          : previousDay(input.intervals[index + 1] ?? ''),
      totalAssets: perAssets,
      totalDebts: perDebts,
      netAssets: perTotals > 0 ? perTotals : 0,
      netDebts: perTotals < 0 ? perTotals : 0,
      totalTotals: perTotals,
      totalBudgeted: perTotals,
      series,
    }
  })
  return { intervalData, totalAssets, totalDebts, netAssets, netDebts }
}

/** 区间展示标签（官方 `getIntervalFormat` 的等价：按粒度给标签）。 */
function intervalLabel(interval: string, key: string): string {
  if (interval === 'Yearly') return key.slice(0, 4)
  if (interval === 'Monthly') {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    const month = Number(key.slice(5, 7))
    return `${months[month - 1] ?? key} '${key.slice(2, 4)}`
  }
  return key
}

/** 前一天（区间结束日推算）。 */
function previousDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`)
  date.setDate(date.getDate() - 1)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 计算单个系列（官方 `recalculate`）。 */
export function buildGroupEntry(input: {
  item: GroupItem
  intervals: string[]
  assets: RawReportRow[]
  debts: RawReportRow[]
  label: string
  options: FilterOptions
  startDate: string
  endDate: string
}): GroupEntry {
  const groupByCategory = input.label === 'category' || input.label === 'categoryGroup'
  let totalAssets = 0
  let totalDebts = 0
  const intervalData: GroupIntervalEntry[] = []
  input.intervals.forEach((intervalKey, index) => {
    const last = intervalData.length === 0 ? undefined : intervalData[intervalData.length - 1]
    const intervalAssets = sumRows(
      input.item,
      input.assets,
      input.label,
      intervalKey,
      input.options,
      groupByCategory,
    )
    const intervalDebts = sumRows(
      input.item,
      input.debts,
      input.label,
      intervalKey,
      input.options,
      groupByCategory,
    )
    totalAssets += intervalAssets
    totalDebts += intervalDebts
    const totals = intervalAssets + intervalDebts
    intervalData.push({
      key: intervalKey,
      intervalStartDate: index === 0 ? input.startDate : intervalKey,
      intervalEndDate:
        index + 1 === input.intervals.length
          ? input.endDate
          : previousDay(input.intervals[index + 1] ?? ''),
      totalAssets: intervalAssets,
      totalDebts: intervalDebts,
      netAssets: totals > 0 ? totals : 0,
      netDebts: totals < 0 ? totals : 0,
      totalTotals: totals,
      totalBudgeted: totals,
      change: last === undefined ? 0 : totals - last.totalTotals,
    })
  })
  const totalTotals = totalAssets + totalDebts
  const entry: GroupEntry = {
    id: input.item.id,
    name: input.item.name,
    totalAssets,
    totalDebts,
    netAssets: totalTotals > 0 ? totalTotals : 0,
    netDebts: totalTotals < 0 ? totalTotals : 0,
    totalTotals,
    totalBudgeted: totalTotals,
    intervalData,
  }
  if (input.item.uncategorizedId !== undefined) entry.uncategorizedId = input.item.uncategorizedId
  return entry
}
