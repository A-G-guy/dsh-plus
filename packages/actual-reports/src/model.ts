/**
 * 报表定义模型：与官方 `custom_reports` 表 / `reportModel` 逐字段对齐的
 * camelCase 视图，外加取值白名单与显式校验。
 *
 * 与官方一致的三处细节：
 * - 选项键（interval / groupBy / balanceType / sortBy / dateRange）是**界面文案键**，
 *   不是数据库枚举，因此本文件的白名单必须与官方 `ReportOptions` 表逐条对齐；
 * - `balanceType` 只是界面键，真正参与计算的是它映射出的口径（Payment → totalDebts 等）；
 * - `conditions` 中带 `customName` 的条目是界面临时态，官方在计算前会丢弃，本工具同样丢弃。
 * @module @dsh-plus/actual-reports/model
 */

import { monthFromDate, subMonths } from './dates.ts'

/** 参与计算的金额口径（官方 `balanceTypeOpType` 的子集）。 */
export type BalanceOp =
  | 'totalDebts'
  | 'totalAssets'
  | 'totalTotals'
  | 'netDebts'
  | 'netAssets'
  | 'totalBudgeted'

/** 界面键 → 计算口径（官方 `ReportOptions.balanceTypeMap`）。 */
export const BALANCE_TYPE_OP: Readonly<Record<string, BalanceOp>> = {
  Payment: 'totalDebts',
  Deposit: 'totalAssets',
  Net: 'totalTotals',
  'Net Payment': 'netDebts',
  'Net Deposit': 'netAssets',
  Budgeted: 'totalBudgeted',
}

/**
 * 分组键白名单（官方 `groupByOptions` 的全部合法取值）。
 * `Tag` 是官方合法取值但本工具 v1 未实现，由 `assertComputable` 给出明确拒绝。
 */
export const GROUP_BY_KEYS: readonly string[] = [
  'Category',
  'Group',
  'CategoryGroup',
  'Payee',
  'Account',
  'Interval',
  'Tag',
]

/**
 * 排序键白名单：**存储词表**是官方 `sortByOpType`（`asc`/`desc`/`name`/`budget`），
 * 界面上的 Ascending/Descending 只是标签（其 format 才是存储值）。
 */
export const SORT_BY_KEYS: readonly string[] = ['asc', 'desc', 'name', 'budget']

/** 界面标签 → 存储值（人类照界面念参数时的容错，仅输入侧生效）。 */
const SORT_BY_ALIASES: Readonly<Record<string, string>> = {
  ascending: 'asc',
  descending: 'desc',
  name: 'name',
  budget: 'budget',
}

/** 排序键归一：接受存储值与界面标签（大小写不敏感）。 */
function normalizeSortBy(raw: unknown, fallback: string): string {
  if (raw === undefined || raw === null || raw === '') return fallback
  if (typeof raw !== 'string') throw new Error('报表定义非法：sortBy 必须是字符串')
  const alias = SORT_BY_ALIASES[raw.toLowerCase()]
  return alias ?? raw
}

/** 粒度白名单与其区间键（官方 `intervalOptions`）。 */
export const INTERVAL_SPEC: Readonly<Record<string, { range: string }>> = {
  Daily: { range: 'dayRangeInclusive' },
  Weekly: { range: 'weekRangeInclusive' },
  Monthly: { range: 'rangeInclusive' },
  Yearly: { range: 'yearRangeInclusive' },
}

/** 模式白名单：total = 合计视图，time = 时间视图。 */
export const MODE_KEYS: readonly string[] = ['total', 'time']

/** 实时区间键 → 官方区间标识（官方 `dateRangeOptions` 的 key/name/type）。 */
export interface DateRangeSpec {
  /** 官方 `name`：数字表示「往前 N 个周期」，字符串是特殊区间标识。 */
  name: number | string
  /** 官方 `type`：Week / Month / Day。 */
  type: string
}

/** 实时区间表（逐条抄自官方 `dateRangeOptions`）。 */
export const DATE_RANGE_SPEC: Readonly<Record<string, DateRangeSpec>> = {
  'This week': { name: 0, type: 'Week' },
  'Last week': { name: 1, type: 'Week' },
  'This month': { name: 0, type: 'Month' },
  'Last month': { name: 1, type: 'Month' },
  'Current quarter': { name: 'currentQuarter', type: 'Month' },
  'Previous quarter': { name: 'previousQuarter', type: 'Month' },
  'Last 30 days': { name: 'last30Days', type: 'Day' },
  'Last 3 months': { name: 3, type: 'Month' },
  'Last 6 months': { name: 6, type: 'Month' },
  'Last 12 months': { name: 12, type: 'Month' },
  'Year to date': { name: 'yearToDate', type: 'Month' },
  'Last year': { name: 'lastYear', type: 'Month' },
  'Prior year to date': { name: 'priorYearToDate', type: 'Month' },
  'All time': { name: 'allTime', type: 'Month' },
}

/** 报表条件（官方 `RuleConditionEntity` 的形状子集，其余字段原样透传）。 */
export interface ReportCondition {
  field: string
  op: string
  value: unknown
  [key: string]: unknown
}

/** 报表定义（camelCase；字段与官方 `reportModel.toJS` 一一对应）。 */
export interface ReportDefinition {
  id?: string
  name: string
  startDate: string
  endDate: string
  isDateStatic: boolean
  dateRange: string
  mode: string
  groupBy: string
  sortBy: string
  interval: string
  balanceType: string
  showEmpty: boolean
  showOffBudget: boolean
  showHiddenCategories: boolean
  showUncategorized: boolean
  trimIntervals: boolean
  showTrendLines: boolean
  includeCurrentInterval: boolean
  graphType: string
  conditions: ReportCondition[]
  conditionsOp: 'and' | 'or'
  metadata?: unknown
}

/** 官方 `defaultReport` 的默认值（随 `today` 变化的两项单独计算）。 */
function defaultsOf(today: string): Omit<ReportDefinition, 'id' | 'metadata'> {
  return {
    name: '',
    startDate: `${subMonths(monthFromDate(today), 5)}-01`,
    endDate: today,
    isDateStatic: false,
    dateRange: 'Last 6 months',
    mode: 'total',
    groupBy: 'Category',
    sortBy: 'desc',
    interval: 'Monthly',
    balanceType: 'Payment',
    showEmpty: false,
    showOffBudget: false,
    showHiddenCategories: true,
    showUncategorized: true,
    trimIntervals: false,
    showTrendLines: false,
    includeCurrentInterval: true,
    graphType: 'BarGraph',
    conditions: [],
    conditionsOp: 'and',
  }
}

/** 取对象字段（非对象输入按空对象处理）。 */
function recordOf(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

/** 取字符串字段：缺省/空串回落默认。 */
function stringOf(raw: unknown, fallback: string, field: string): string {
  if (raw === undefined || raw === null || raw === '') return fallback
  if (typeof raw !== 'string') throw new Error(`报表定义非法：${field} 必须是字符串`)
  return raw
}

/** 取布尔字段：缺省回落默认。 */
function boolOf(raw: unknown, fallback: boolean, field: string): boolean {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw !== 'boolean') throw new Error(`报表定义非法：${field} 必须是布尔值`)
  return raw
}

/** 白名单校验，失败时列出全部合法取值。 */
function assertKey(value: string, allowed: readonly string[], field: string): void {
  if (!allowed.includes(value)) {
    throw new Error(
      `报表定义非法：${field} = ${JSON.stringify(value)}，合法取值：${allowed.join(' / ')}`,
    )
  }
}

/** 条件数组校验（结构不符即报错；带 customName 的界面临时态丢弃）。 */
function conditionsOf(raw: unknown): ReportCondition[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('报表定义非法：conditions 必须是数组')
  return raw
    .filter((item) => recordOf(item).customName === undefined)
    .map((item, index) => {
      const record = recordOf(item)
      if (typeof record.field !== 'string' || typeof record.op !== 'string') {
        throw new Error(
          `报表定义非法：conditions[${index}] 需要 field 与 op 字符串（实际：${JSON.stringify(item)}）`,
        )
      }
      return record as ReportCondition
    })
}

/**
 * 归一化 + 校验报表定义。
 *
 * @param input - 模型或用户给出的定义片段（缺省字段用官方默认值补齐）。
 * @param options - `today` 决定默认起止日期；`requireName` 为真时 name 必填。
 * @throws 字段类型不符或取值不在白名单时抛出（含合法取值清单）。
 */
export function normalizeReport(
  input: unknown,
  options: { today: string; requireName: boolean },
): ReportDefinition {
  const raw = recordOf(input)
  const defaults = defaultsOf(options.today)
  const name = stringOf(raw.name, defaults.name, 'name')
  if (options.requireName && name.trim() === '') {
    throw new Error('报表定义非法：name 必填（用于在界面的报表列表里标识这张报表）')
  }
  const definition: ReportDefinition = {
    name,
    startDate: stringOf(raw.startDate, defaults.startDate, 'startDate'),
    endDate: stringOf(raw.endDate, defaults.endDate, 'endDate'),
    isDateStatic: boolOf(raw.isDateStatic, defaults.isDateStatic, 'isDateStatic'),
    dateRange: stringOf(raw.dateRange, defaults.dateRange, 'dateRange'),
    mode: stringOf(raw.mode, defaults.mode, 'mode'),
    groupBy: stringOf(raw.groupBy, defaults.groupBy, 'groupBy'),
    sortBy: normalizeSortBy(raw.sortBy, defaults.sortBy),
    interval: stringOf(raw.interval, defaults.interval, 'interval'),
    balanceType: stringOf(raw.balanceType, defaults.balanceType, 'balanceType'),
    showEmpty: boolOf(raw.showEmpty, defaults.showEmpty, 'showEmpty'),
    showOffBudget: boolOf(raw.showOffBudget, defaults.showOffBudget, 'showOffBudget'),
    showHiddenCategories: boolOf(
      raw.showHiddenCategories,
      defaults.showHiddenCategories,
      'showHiddenCategories',
    ),
    showUncategorized: boolOf(
      raw.showUncategorized,
      defaults.showUncategorized,
      'showUncategorized',
    ),
    trimIntervals: boolOf(raw.trimIntervals, defaults.trimIntervals, 'trimIntervals'),
    showTrendLines: boolOf(raw.showTrendLines, defaults.showTrendLines, 'showTrendLines'),
    includeCurrentInterval: boolOf(
      raw.includeCurrentInterval,
      defaults.includeCurrentInterval,
      'includeCurrentInterval',
    ),
    graphType: stringOf(raw.graphType, defaults.graphType, 'graphType'),
    conditions: conditionsOf(raw.conditions),
    conditionsOp:
      stringOf(raw.conditionsOp, defaults.conditionsOp, 'conditionsOp') === 'or' ? 'or' : 'and',
  }
  if (raw.id !== undefined) {
    if (typeof raw.id !== 'string') throw new Error('报表定义非法：id 必须是字符串')
    definition.id = raw.id
  }
  if (raw.metadata !== undefined) definition.metadata = raw.metadata
  assertKey(definition.mode, MODE_KEYS, 'mode')
  assertKey(definition.groupBy, GROUP_BY_KEYS, 'groupBy')
  assertKey(definition.sortBy, SORT_BY_KEYS, 'sortBy')
  assertKey(definition.interval, Object.keys(INTERVAL_SPEC), 'interval')
  assertKey(definition.balanceType, Object.keys(BALANCE_TYPE_OP), 'balanceType')
  if (!definition.isDateStatic)
    assertKey(definition.dateRange, Object.keys(DATE_RANGE_SPEC), 'dateRange')
  return definition
}

/**
 * 计算能力检查：v1 未实现的旋钮必须当场报错，绝不静默算成别的口径。
 * @throws 命中未支持旋钮时抛出，并在文案里给出替代做法。
 */
export function assertComputable(definition: ReportDefinition): void {
  if (definition.balanceType === 'Budgeted') {
    throw new Error(
      'balanceType=Budgeted（预算口径）暂不支持：v1 支持 Payment / Deposit / Net / Net Payment / Net Deposit。',
    )
  }
  if (definition.groupBy === 'Tag') {
    throw new Error(
      'groupBy=Tag（标签分组）暂不支持：v1 支持 Category / Group / CategoryGroup / Payee / Account / Interval。',
    )
  }
}

/**
 * 官方 `report/get` 返回的模型（camelCase）→ 定义。
 *
 * 这条路径**只做形状映射、不做白名单校验**：存量报表可能由更新的界面写入，
 * 读到不认识的取值时应当原样透传（能不能算由 `assertComputable` 决定），
 * 而不是在读的时候拒绝。
 */
export function fromModel(model: unknown): ReportDefinition {
  const raw = recordOf(model)
  const definition: ReportDefinition = {
    ...defaultsOf('1970-01-01'),
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(typeof raw.startDate === 'string' ? { startDate: raw.startDate } : {}),
    ...(typeof raw.endDate === 'string' ? { endDate: raw.endDate } : {}),
    ...(typeof raw.isDateStatic === 'boolean' ? { isDateStatic: raw.isDateStatic } : {}),
    ...(typeof raw.dateRange === 'string' ? { dateRange: raw.dateRange } : {}),
    ...(typeof raw.mode === 'string' ? { mode: raw.mode } : {}),
    ...(typeof raw.groupBy === 'string' ? { groupBy: raw.groupBy } : {}),
    ...(typeof raw.sortBy === 'string' ? { sortBy: raw.sortBy } : {}),
    ...(typeof raw.interval === 'string' ? { interval: raw.interval } : {}),
    ...(typeof raw.balanceType === 'string' ? { balanceType: raw.balanceType } : {}),
    ...(typeof raw.showEmpty === 'boolean' ? { showEmpty: raw.showEmpty } : {}),
    ...(typeof raw.showOffBudget === 'boolean' ? { showOffBudget: raw.showOffBudget } : {}),
    ...(typeof raw.showHiddenCategories === 'boolean'
      ? { showHiddenCategories: raw.showHiddenCategories }
      : {}),
    ...(typeof raw.showUncategorized === 'boolean'
      ? { showUncategorized: raw.showUncategorized }
      : {}),
    ...(typeof raw.trimIntervals === 'boolean' ? { trimIntervals: raw.trimIntervals } : {}),
    ...(typeof raw.showTrendLines === 'boolean' ? { showTrendLines: raw.showTrendLines } : {}),
    ...(typeof raw.includeCurrentInterval === 'boolean'
      ? { includeCurrentInterval: raw.includeCurrentInterval }
      : {}),
    ...(typeof raw.graphType === 'string' ? { graphType: raw.graphType } : {}),
    conditions: conditionsOf(raw.conditions),
    conditionsOp: raw.conditionsOp === 'or' ? ('or' as const) : ('and' as const),
  }
  if (typeof raw.id === 'string') definition.id = raw.id
  if (raw.metadata !== undefined) definition.metadata = raw.metadata
  return definition
}

/** 该定义对应的计算口径。 */
export function balanceOpOf(definition: ReportDefinition): BalanceOp {
  const op = BALANCE_TYPE_OP[definition.balanceType]
  if (op === undefined) {
    throw new Error(
      `报表定义非法：balanceType = ${JSON.stringify(definition.balanceType)}，` +
        `合法取值：${Object.keys(BALANCE_TYPE_OP).join(' / ')}`,
    )
  }
  return op
}
