/**
 * 预算替身：以内存取代表官方 api 与 server handler，供计算链路与 CLI 端到端测试使用。
 *
 * 设计边界：
 * - `aqlQuery` 不模拟 AQL 语义，只按表返回**已聚合好的**行（聚合是服务端职责）；
 *   本包要验的是「查询怎么拼」与「行怎么算」，前者由 `queries` 记录断言；
 * - `call` 只认预期内的 handler，其余一律抛错——测试里出现意外调用应当立刻失败。
 * @module @dsh-plus/actual-reports/tests/fixtures/fake-budget
 */

import type { ActualApiLib, ActualApiModule, QueryBuilder } from '../../src/api.ts'

/** 一次 handler 调用的记录。 */
export interface CallRecord {
  name: string
  args: unknown
}

/** 替身输入。 */
export interface FakeBudgetFixture {
  reports?: unknown[]
  categories?: Record<string, unknown>[]
  categoryGroups?: Record<string, unknown>[]
  payees?: Record<string, unknown>[]
  accounts?: Record<string, unknown>[]
  preferences?: Record<string, unknown>[]
  /** 仪表盘页面行（缺省给一页 Main）。 */
  dashboardPages?: Record<string, unknown>[]
  /** 仪表盘组件行（meta 以 JSON 文本给出，与 SQLite 存储一致）。 */
  dashboard?: Record<string, unknown>[]
  /** 已聚合的流入行（amount > 0）。 */
  assets?: Record<string, unknown>[]
  /** 已聚合的流出行（amount < 0）。 */
  debts?: Record<string, unknown>[]
  earliest?: string
  latest?: string
  budgets?: unknown[]
  /** `make-filters-from-conditions` 的返回。 */
  conditionsFilters?: unknown[]
}

/** 记录的查询构造过程。 */
export class FakeQuery implements QueryBuilder {
  readonly filters: unknown[] = []
  groupByFields: unknown[] = []
  selectedFields: unknown[] = []

  readonly table: string

  constructor(table: string) {
    this.table = table
  }

  filter(expr: unknown): QueryBuilder {
    this.filters.push(expr)
    return this
  }

  groupBy(fields: unknown[]): QueryBuilder {
    this.groupByFields = fields
    return this
  }

  select(fields: unknown[]): QueryBuilder {
    this.selectedFields = fields
    return this
  }

  serialize(): unknown {
    return { table: this.table, filters: this.filters }
  }
}

/** 替身句柄。 */
export interface FakeBudget {
  api: ActualApiModule
  lib: ActualApiLib
  call(name: string, args?: unknown): Promise<unknown>
  calls: CallRecord[]
  queries: FakeQuery[]
}

/** 造一个预算替身。 */
export function fakeBudget(fixture: FakeBudgetFixture = {}): FakeBudget {
  const calls: CallRecord[] = []
  const queries: FakeQuery[] = []

  // 仪表盘是可写的：页面与组件用可变数组承载，写动作真的生效，读回才有意义。
  const pages: Record<string, unknown>[] = [
    ...(fixture.dashboardPages ?? [{ id: 'page-1', name: 'Main', tombstone: 0 }]),
  ]
  const widgets: Record<string, unknown>[] = [...(fixture.dashboard ?? [])]
  const reports: Record<string, unknown>[] = [
    ...((fixture.reports ?? []) as Record<string, unknown>[]),
  ]

  const rowsOf = (table: string): Record<string, unknown>[] => {
    switch (table) {
      case 'categories':
        return fixture.categories ?? []
      case 'category_groups':
        return fixture.categoryGroups ?? []
      case 'payees':
        return fixture.payees ?? []
      case 'accounts':
        return fixture.accounts ?? []
      case 'preferences':
        return fixture.preferences ?? []
      case 'dashboard_pages':
        return pages
      case 'dashboard':
        return widgets
      default:
        throw new Error(`替身未提供表：${table}`)
    }
  }

  /** 组件行的 id 序号（新建/复制时给出稳定可断言的 id）。 */
  let widgetSeq = 0
  const nextWidgetId = (): string => {
    widgetSeq += 1
    return `widget-new-${widgetSeq}`
  }

  /** 官方 `addDashboardWidget` 的自动排版（12 列网格）。 */
  const autoPlace = (row: Record<string, unknown>): void => {
    if ('x' in row || 'y' in row) return
    const page = widgets.filter(
      (item) => item.dashboard_page_id === row.dashboard_page_id && item.tombstone !== 1,
    )
    const last = page.sort(
      (left, right) => Number(right.y) - Number(left.y) || Number(right.x) - Number(left.x),
    )[0]
    if (last === undefined) {
      row.x = 0
      row.y = 0
      return
    }
    const boundary = Number(last.x) + Number(last.width) + Number(row.width)
    row.x = boundary > 12 ? 0 : Number(last.x) + Number(last.width)
    row.y = Number(last.y) + (boundary > 12 ? Number(last.height) : 0)
  }

  const call = async (name: string, args?: unknown): Promise<unknown> => {
    calls.push({ name, args })
    switch (name) {
      case 'report/get':
        return reports
      case 'report/create': {
        // 官方会生成 id 并落库；替身照做，读回（report/get）才能反映新建结果。
        const created = { ...(args as Record<string, unknown>), id: 'created-report-id' }
        reports.push(created)
        return 'created-report-id'
      }
      case 'report/update': {
        const item = args as Record<string, unknown>
        const index = reports.findIndex((row) => row.id === item.id)
        if (index === -1) throw new Error(`替身未找到待更新报表：${String(item.id)}`)
        reports[index] = { ...item }
        return undefined
      }
      case 'report/delete': {
        const index = reports.findIndex((row) => row.id === args)
        if (index === -1) throw new Error(`替身未找到待删除报表：${String(args)}`)
        reports.splice(index, 1)
        return undefined
      }
      case 'dashboard-create': {
        const page = {
          id: `page-new-${pages.length + 1}`,
          name: (args as { name: string }).name,
          tombstone: 0,
        }
        pages.push(page)
        return page.id
      }
      case 'dashboard-rename': {
        const target = args as { id: string; name: string }
        const page = pages.find((item) => item.id === target.id)
        if (page === undefined) throw new Error(`替身未找到待改名页面：${target.id}`)
        page.name = target.name
        return undefined
      }
      case 'dashboard-delete': {
        const alive = pages.filter((item) => item.tombstone !== 1)
        if (alive.length <= 1) throw new Error('Cannot delete the last dashboard page')
        const index = pages.findIndex((item) => item.id === args)
        if (index === -1) throw new Error(`替身未找到待删除页面：${String(args)}`)
        pages.splice(index, 1)
        for (let i = widgets.length - 1; i >= 0; i -= 1) {
          if (widgets[i]?.dashboard_page_id === args) widgets.splice(i, 1)
        }
        return undefined
      }
      case 'dashboard-reset': {
        for (let i = widgets.length - 1; i >= 0; i -= 1) {
          if (widgets[i]?.dashboard_page_id === args) widgets.splice(i, 1)
        }
        // 官方语义是「恢复默认组件集」；替身只放一个最小默认组件（测试只验替换发生）。
        widgets.push({
          id: nextWidgetId(),
          dashboard_page_id: args,
          type: 'net-worth-card',
          width: 8,
          height: 2,
          x: 0,
          y: 0,
          meta: null,
          tombstone: 0,
        })
        return undefined
      }
      case 'dashboard-add-widget': {
        const row = { ...(args as Record<string, unknown>) }
        autoPlace(row)
        row.id = nextWidgetId()
        row.tombstone = 0
        if (typeof row.meta === 'object' && row.meta !== null) row.meta = JSON.stringify(row.meta)
        widgets.push(row)
        return undefined
      }
      case 'dashboard-update-widget': {
        const row = { ...(args as Record<string, unknown>) }
        if (typeof row.meta === 'object' && row.meta !== null) row.meta = JSON.stringify(row.meta)
        const index = widgets.findIndex((item) => item.id === row.id)
        if (index === -1) throw new Error(`替身未找到待更新组件：${String(row.id)}`)
        widgets[index] = row
        return undefined
      }
      case 'dashboard-update': {
        for (const patch of args as Record<string, unknown>[]) {
          const index = widgets.findIndex((item) => item.id === patch.id)
          if (index === -1) throw new Error(`替身未找到待排版组件：${String(patch.id)}`)
          widgets[index] = { ...(widgets[index] as Record<string, unknown>), ...patch }
        }
        return undefined
      }
      case 'dashboard-remove-widget': {
        const index = widgets.findIndex((item) => item.id === args)
        if (index >= 0) widgets.splice(index, 1)
        return undefined
      }
      case 'dashboard-copy-widget': {
        const target = args as { id: string; targetDashboardPageId: string }
        const source = widgets.find((item) => item.id === target.id && item.tombstone !== 1)
        if (source === undefined) throw new Error(`Widget not found: ${target.id}`)
        const row: Record<string, unknown> = {
          type: source.type,
          width: source.width,
          height: source.height,
          meta: source.meta ?? null,
          dashboard_page_id: target.targetDashboardPageId,
        }
        autoPlace(row)
        row.id = nextWidgetId()
        row.tombstone = 0
        widgets.push(row)
        return undefined
      }
      case 'make-filters-from-conditions':
        return { filters: fixture.conditionsFilters ?? [] }
      case 'get-earliest-transaction':
        return fixture.earliest === undefined ? undefined : { date: fixture.earliest }
      case 'get-latest-transaction':
        return fixture.latest === undefined ? undefined : { date: fixture.latest }
      default:
        throw new Error(`替身未预期的 handler：${name}`)
    }
  }

  const api: ActualApiModule = {
    init: async () => ({ send: call }),
    shutdown: async () => undefined,
    downloadBudget: async () => undefined,
    loadBudget: async () => undefined,
    sync: async () => undefined,
    getBudgets: async () => fixture.budgets ?? [{ id: 'budget-1', groupId: 'sync-1' }],
    q: (table: string) => {
      const query = new FakeQuery(table)
      queries.push(query)
      return query
    },
    aqlQuery: async (query) => {
      if (!(query instanceof FakeQuery)) throw new Error('替身只接受 FakeQuery')
      if (query.table === 'transactions') {
        const side = JSON.stringify(query.filters).includes('"$gt":0') ? 'assets' : 'debts'
        return { data: fixture[side] ?? [] }
      }
      return { data: rowsOf(query.table) }
    },
  }

  return { api, lib: { send: call }, call, calls, queries }
}
