/**
 * 分组维度：把分类/分组/收款人/账户整理成报表的「系列」列表——官方
 * `categoryLists` + `groupBySelections` 的等价端口。
 *
 * 对齐要点：
 * - 分类列表按「收入分组在后」→ 分组 sort_order → 分类 sort_order 排序，且只在两个
 *   分类都带 sort_order、分组都能查到时才比较（官方同款保守写法）；
 * - 列表尾部追加三个虚拟项：Uncategorized / Off budget / Transfers，它们的
 *   `uncategorizedId` 决定 `filterHiddenItems` 如何归集；
 * - 分组维度（Group / CategoryGroup）另加一个 `uncategorized_id = 'all'` 的虚拟分组；
 * - `Interval` 维度在官方自定义报表里与 `Category` 同构（差别只在图例展示），此处照做。
 * @module @dsh-plus/actual-reports/groups
 */

import type { BudgetFacts, RawRow } from './query.ts'

/** 维度标签：查询结果里用于取分组键的字段名。 */
export type GroupByLabel = 'category' | 'categoryGroup' | 'payee' | 'account'

/** 虚拟归集项标识（官方 `UncategorizedId`）。 */
export type UncategorizedId = 'off_budget' | 'transfer' | 'other' | 'all'

/** 一个系列（分组项）。 */
export interface GroupItem {
  id: string
  name: string
  hidden: boolean
  /** 仅虚拟项存在。 */
  uncategorizedId?: UncategorizedId
}

/** 分组结果：系列列表 + 取键字段。 */
export interface GroupSelection {
  items: GroupItem[]
  label: GroupByLabel
}

/** 分类行（含排序所需的字段）。 */
interface CategoryItem {
  id: string
  name: string
  hidden: boolean
  group: string
  sortOrder: number | undefined
}

/** 分类分组行。 */
interface CategoryGroupItem {
  id: string
  name: string
  hidden: boolean
  isIncome: boolean
  sortOrder: number | undefined
}

/** 数字字段读取（非数字一律 undefined，避免 0 与缺失混淆）。 */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 官方三个虚拟分类。 */
const UNCATEGORIZED_CATEGORY: GroupItem = {
  id: '',
  name: 'Uncategorized',
  hidden: false,
  uncategorizedId: 'other',
}
const TRANSFER_CATEGORY: GroupItem = {
  id: '',
  name: 'Transfers',
  hidden: false,
  uncategorizedId: 'transfer',
}
const OFF_BUDGET_CATEGORY: GroupItem = {
  id: '',
  name: 'Off budget',
  hidden: false,
  uncategorizedId: 'off_budget',
}

/** 官方虚拟分组（包含上述三个虚拟分类）。 */
const UNCATEGORIZED_GROUP: GroupItem = {
  id: 'uncategorized',
  name: 'Uncategorized & Off budget',
  hidden: false,
  uncategorizedId: 'all',
}

/** 原始行 → 分类项。 */
function toCategoryItem(row: RawRow): CategoryItem {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    hidden: row.hidden === 1,
    group: String(row.group ?? ''),
    sortOrder: numberOrUndefined(row.sort_order),
  }
}

/** 原始行 → 分类分组项。 */
function toCategoryGroupItem(row: RawRow): CategoryGroupItem {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    hidden: row.hidden === 1,
    isIncome: row.is_income === 1,
    sortOrder: numberOrUndefined(row.sort_order),
  }
}

/**
 * 分类排序（官方比较器：收入分组在后 → 分组序号 → 分类序号）。
 * 缺 sort_order 或查不到分组时视为等序（官方行为）。
 */
function compareCategories(
  left: CategoryItem,
  right: CategoryItem,
  groups: Map<string, CategoryGroupItem>,
): number {
  const leftGroup = groups.get(left.group)
  const rightGroup = groups.get(right.group)
  if (left.sortOrder === undefined || right.sortOrder === undefined) return 0
  if (left.sortOrder === 0 || right.sortOrder === 0) return 0
  if (leftGroup === undefined || rightGroup === undefined) return 0
  const income = Number(leftGroup.isIncome) - Number(rightGroup.isIncome)
  if (income !== 0) return income
  const groupOrder = (leftGroup.sortOrder ?? 0) - (rightGroup.sortOrder ?? 0)
  if (groupOrder !== 0) return groupOrder
  return left.sortOrder - right.sortOrder
}

/** 分类系列列表（官方 `categoryLists` 的第一项）。 */
function categoryItems(facts: BudgetFacts): GroupItem[] {
  const groups = new Map(
    facts.categoryGroups.map((row) => [String(row.id ?? ''), toCategoryGroupItem(row)]),
  )
  const sorted = facts.categories
    .map(toCategoryItem)
    .sort((left, right) => compareCategories(left, right, groups))
  return [
    ...sorted.map((item) => ({ id: item.id, name: item.name, hidden: item.hidden })),
    UNCATEGORIZED_CATEGORY,
    OFF_BUDGET_CATEGORY,
    TRANSFER_CATEGORY,
  ]
}

/** 分组系列列表（官方 `categoryLists` 的第二项）。 */
function categoryGroupItems(facts: BudgetFacts): GroupItem[] {
  return [
    ...facts.categoryGroups.map((row) => {
      const item = toCategoryGroupItem(row)
      return { id: item.id, name: item.name, hidden: item.hidden }
    }),
    UNCATEGORIZED_GROUP,
  ]
}

/**
 * 按维度取系列列表。
 *
 * @throws `Tag` 维度（v1 不支持）或未知维度时抛出，并列出合法取值。
 */
export function selectGroups(groupBy: string, facts: BudgetFacts): GroupSelection {
  switch (groupBy) {
    case 'Category':
      return { items: categoryItems(facts), label: 'category' }
    case 'Group':
    case 'CategoryGroup':
      // CategoryGroup 在官方是「组内再分分类」的两环图；数值与 Group 同源。
      return { items: categoryGroupItems(facts), label: 'categoryGroup' }
    case 'Payee':
      return {
        items: facts.payees.map((row) => ({
          id: String(row.id ?? ''),
          name: String(row.name ?? ''),
          hidden: false,
        })),
        label: 'payee',
      }
    case 'Account':
      return {
        items: facts.accounts.map((row) => ({
          id: String(row.id ?? ''),
          name: String(row.name ?? ''),
          hidden: false,
        })),
        label: 'account',
      }
    case 'Interval':
      // 官方自定义报表里 Interval 与 Category 同构（差异只在图例）。
      return { items: categoryItems(facts), label: 'category' }
    default:
      throw new Error(
        `未知的 groupBy：${JSON.stringify(groupBy)}。合法取值：Category / Group / CategoryGroup / Payee / Account / Interval。`,
      )
  }
}
