/**
 * 已存报表的读写：全部经官方 server handler（`report/get|create|update|delete`），
 * 因此与界面共用同一套唯一性校验、同一条 undo/同步链路。
 *
 * 删除保护：报表可能被仪表盘组件引用（`dashboard.type = 'custom-report'`，
 * 引用写在 `meta.id` 里），因此删除前先扫引用；不给 `--force` 就拒绝，
 * 给了就同时移除这些组件——避免留下永远渲染失败的 `MissingReportCard`。
 * @module @dsh-plus/actual-reports/report-store
 */

import type { ActualApiModule, QueryBuilder } from './api.ts'
import { fromModel, type ReportDefinition } from './model.ts'

/** 访问面：handler 调用 + AQL 查询。 */
export interface ReportsAccess {
  api: ActualApiModule
  call(name: string, args?: unknown): Promise<unknown>
}

/** 报表选择器（id 或名称）。 */
export interface ReportSelector {
  reportId?: string
  name?: string
}

/** 引用某报表的仪表盘组件。 */
export interface WidgetRef {
  pageId: string
  widgetId: string
}

/** 选择器校验：必须给出其一。 */
export function requireSelector(selector: ReportSelector): void {
  if (selector.reportId === undefined && selector.name === undefined) {
    throw new Error('需要指定报表：给 --report-id（推荐，用 `report list` 取）或 --name。')
  }
}

/** 读取全部报表定义（官方 `report/get`，已按名称排序）。 */
export async function listReports(access: ReportsAccess): Promise<ReportDefinition[]> {
  const result = await access.call('report/get')
  if (!Array.isArray(result)) {
    throw new Error(
      '报表能力不可用：服务端 report/get 未返回报表数组' +
        `（实际：${JSON.stringify(result)?.slice(0, 200)}）。请更新官方 CLI 后重试。`,
    )
  }
  return result.map((item) => fromModel(item))
}

/** 从列表里挑一张（按 id 精确匹配，或按名称匹配）。 */
export function pickReport(
  reports: ReportDefinition[],
  selector: ReportSelector,
): ReportDefinition {
  requireSelector(selector)
  if (selector.reportId !== undefined) {
    const byId = reports.find((item) => item.id === selector.reportId)
    if (byId === undefined) throw notFound(selector, reports)
    return byId
  }
  const byName = reports.filter((item) => item.name === selector.name)
  if (byName.length === 0) throw notFound(selector, reports)
  if (byName.length > 1) {
    throw new Error(
      `报表名称不唯一：name = ${JSON.stringify(selector.name)} 命中 ${byName.length} 张` +
        `（id：${byName.map((item) => item.id ?? '?').join('、')}）。请改用 --report-id。`,
    )
  }
  return byName[0] as ReportDefinition
}

/** 找不到报表的错误（附现有报表清单，便于模型自我纠正）。 */
function notFound(selector: ReportSelector, reports: ReportDefinition[]): Error {
  const key =
    selector.reportId !== undefined
      ? `id = ${selector.reportId}`
      : `name = ${JSON.stringify(selector.name)}`
  const available = reports
    .slice(0, 20)
    .map((item) => `${item.name}(${item.id ?? '?'})`)
    .join('、')
  return new Error(
    `找不到报表：${key}。当前预算里的报表：${available || '（没有已保存的报表）'}。` +
      '请用 `report list` 查看全部。',
  )
}

/** 按选择器读取一张报表。 */
export async function readReport(
  access: ReportsAccess,
  selector: ReportSelector,
): Promise<ReportDefinition> {
  return pickReport(await listReports(access), selector)
}

/**
 * 新建报表。
 * @returns 新报表 id（官方 `report/create` 的返回值）。
 * @throws 名称重复等官方校验失败时抛出（附官方原因）。
 */
export async function createReport(
  access: ReportsAccess,
  definition: ReportDefinition,
): Promise<string> {
  const payload: Record<string, unknown> = { ...definition }
  delete payload.id
  const id = await access.call('report/create', payload)
  if (typeof id !== 'string' || id === '') {
    throw new Error(`report/create 未返回新报表 id（实际：${JSON.stringify(id)?.slice(0, 200)}）`)
  }
  return id
}

/** 更新报表（需要完整定义，含 id；官方要求 name 非空且唯一）。 */
export async function updateReport(
  access: ReportsAccess,
  definition: ReportDefinition,
): Promise<void> {
  if (definition.id === undefined || definition.id === '') {
    throw new Error('更新报表需要已知的报表 id：请先用 --report-id 或 --name 选中一张已存报表。')
  }
  await access.call('report/update', { ...definition })
}

/** 扫出引用该报表的仪表盘组件（含所属页）。 */
export async function reportWidgetReferences(
  access: ReportsAccess,
  reportId: string,
): Promise<WidgetRef[]> {
  const rows = await access.api.aqlQuery((access.api.q('dashboard') as QueryBuilder).select(['*']))
  const data = (rows as { data?: unknown }).data
  if (!Array.isArray(data)) {
    throw new Error('读取仪表盘失败：dashboard 查询未返回数据数组')
  }
  const refs: WidgetRef[] = []
  for (const item of data as Record<string, unknown>[]) {
    if (item.tombstone === 1 || item.type !== 'custom-report') continue
    const meta = parseMeta(item.meta, String(item.id ?? '?'))
    if (meta?.id === reportId) {
      refs.push({ pageId: String(item.dashboard_page_id ?? ''), widgetId: String(item.id ?? '') })
    }
  }
  return refs
}

/** 解析组件 meta（官方以 JSON 文本存储）。 */
function parseMeta(raw: unknown, widgetId: string): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') {
    throw new Error(`仪表盘组件 ${widgetId} 的 meta 类型异常：${typeof raw}`)
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`仪表盘组件 ${widgetId} 的 meta 不是合法 JSON：${detail}`)
  }
}

/**
 * 删除报表；被组件引用时默认拒绝。
 *
 * @param force - 为真时先移除引用它的组件再删报表。
 * @returns 被移除的组件（未 force 且无引用时为空数组）。
 * @throws 存在引用且未 force 时抛出（附组件与页面清单）。
 */
export async function deleteReport(
  access: ReportsAccess,
  report: ReportDefinition,
  options: { force: boolean },
): Promise<WidgetRef[]> {
  const id = report.id
  if (id === undefined || id === '') {
    throw new Error('删除报表需要已知的报表 id：请先用 --report-id 或 --name 选中一张已存报表。')
  }
  const refs = await reportWidgetReferences(access, id)
  if (refs.length > 0 && !options.force) {
    throw new Error(
      `报表 ${JSON.stringify(report.name)} 正被 ${refs.length} 个仪表盘组件引用` +
        `（组件：${refs.map((ref) => ref.widgetId).join('、')}）。` +
        '确认要连同这些组件一起删除时加 --force；否则请先在界面上换掉这些组件。',
    )
  }
  for (const ref of refs) {
    await access.call('dashboard-remove-widget', ref.widgetId)
  }
  await access.call('report/delete', id)
  return refs
}
