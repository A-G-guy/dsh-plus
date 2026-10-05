/**
 * 仪表盘读写：页面与组件全部经官方 server handler（`dashboard-*`），读取走 AQL
 * 直查表（`dashboard_pages` / `dashboard`），因此与界面共用同一套校验、同一条
 * undo/同步链路。
 *
 * 与官方实现对齐的两条硬约束（读自本机 API 的 schema 校验表）：
 * - `dashboard` 行的 `type`/`width`/`height`/`x`/`y` 都是**必填**，`x`/`y` 由
 *   `dashboard-add-widget` 在**两者都缺**时自动排版（12 列网格），只给一个必被拒；
 * - `dashboard-add-widget` / `dashboard-remove-widget` 都对不存在的目标静默成功，
 *   因此这里先读后写，把「改了个不存在的组件」变成显式错误。
 * @module @dsh-plus/actual-reports/dashboard-store
 */

import type { ActionAccess } from './action.ts'
import type { ActualApiModule, QueryBuilder } from './api.ts'

/** 一页仪表盘。 */
export interface DashboardPage {
  id: string
  name: string
}

/**
 * 一个仪表盘组件行（字段名与官方导入/导出格式一致，便于模型原样复用）。
 * 读出来的行一定有 id 与 x/y；新建时这些字段由官方生成或自动排版。
 */
export interface WidgetRow {
  id: string
  dashboard_page_id: string
  type: string
  width: number
  height: number
  x: number
  y: number
  meta?: Record<string, unknown>
  [key: string]: unknown
}

/** 待写入的组件行（新建时 id/x/y 可缺：id 由官方生成，x/y 由官方自动排版）。 */
export interface WidgetInput {
  dashboard_page_id: string
  type: string
  width: number
  height: number
  id?: string
  x?: number
  y?: number
  meta?: Record<string, unknown>
  [key: string]: unknown
}

/** 组件可写字段（其余字段一律拒绝，避免模型写错字段名而静默丢失）。 */
const WIDGET_FIELDS = [
  'id',
  'dashboard_page_id',
  'type',
  'width',
  'height',
  'x',
  'y',
  'meta',
] as const

/** 读取全部分页（含默认页 `Main`）。 */
export async function listPages(access: ActionAccess): Promise<DashboardPage[]> {
  const rows = await aqlRows(access, 'dashboard_pages')
  return rows
    .filter((row) => row.tombstone !== 1 && row.tombstone !== true)
    .map((row) => ({ id: text(row.id, 'dashboard_pages.id'), name: text(row.name, 'name') }))
}

/**
 * 读取组件行（可选按页过滤）。
 * @param pageId - 只取该页；省略取全部页。
 */
export async function listWidgets(access: ActionAccess, pageId?: string): Promise<WidgetRow[]> {
  const rows = await aqlRows(access, 'dashboard')
  const widgets: WidgetRow[] = []
  for (const row of rows) {
    if (row.tombstone === 1 || row.tombstone === true) continue
    const widget = widgetOf(row)
    if (pageId === undefined || widget.dashboard_page_id === pageId) widgets.push(widget)
  }
  return widgets.sort((left, right) => left.y - right.y || left.x - right.x)
}

/** 页面定位：不存在时报错并附现有页面，便于模型自我纠正。 */
export function requirePage(pages: DashboardPage[], pageId: string): DashboardPage {
  const page = pages.find((item) => item.id === pageId)
  if (page === undefined) {
    const available = pages.map((item) => `${item.name}(${item.id})`).join('、')
    throw new Error(
      `找不到仪表盘页面：page-id = ${pageId}。当前页面：${available || '（没有页面）'}。` +
        '请用 `dashboard list` 查看全部页面。',
    )
  }
  return page
}

/** 组件定位：不存在时报错并附该页现有组件。 */
export function requireWidget(widgets: WidgetRow[], widgetId: string): WidgetRow {
  const widget = widgets.find((item) => item.id === widgetId)
  if (widget === undefined) {
    const available = widgets.map((item) => `${item.type}(${item.id})`).join('、')
    throw new Error(
      `找不到仪表盘组件：widget-id = ${widgetId}。` +
        `当前组件：${available || '（该页没有组件）'}。请用 \`dashboard widgets\` 查看。`,
    )
  }
  return widget
}

/** 输入是否为普通对象（非数组、非 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从严取整数（拒绝小数、字符串数字与缺失值）。 */
function intOf(value: unknown, field: string, range?: { min: number; max?: number }): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`组件字段 ${field} 需要整数，实际为 ${JSON.stringify(value)}`)
  }
  if (range !== undefined && value < range.min) {
    throw new Error(`组件字段 ${field} 不能小于 ${range.min}（实际 ${value}）`)
  }
  if (range?.max !== undefined && value > range.max) {
    throw new Error(`组件字段 ${field} 不能大于 ${range.max}（实际 ${value}）`)
  }
  return value
}

/** 从严取非空字符串。 */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`字段 ${field} 需要非空字符串，实际为 ${JSON.stringify(value)}`)
  }
  return value
}

/** AQL 行 → 组件行（meta 是 JSON 文本，需解析）。 */
function widgetOf(row: Record<string, unknown>): WidgetRow {
  const id = text(row.id, 'dashboard.id')
  const type = text(row.type, `dashboard ${id} 的 type`)
  const widget: WidgetRow = {
    id,
    dashboard_page_id: text(row.dashboard_page_id, `dashboard ${id} 的 dashboard_page_id`),
    type,
    width: intOf(row.width, `dashboard ${id} 的 width`),
    height: intOf(row.height, `dashboard ${id} 的 height`),
    x: intOf(row.x, `dashboard ${id} 的 x`),
    y: intOf(row.y, `dashboard ${id} 的 y`),
  }
  const meta = parseMeta(row.meta, id)
  if (meta !== undefined) widget.meta = meta
  return widget
}

/** 解析组件 meta（官方以 JSON 文本存储，也可能是对象）。 */
export function parseMeta(raw: unknown, widgetId: string): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string') {
    throw new Error(`仪表盘组件 ${widgetId} 的 meta 类型异常：${typeof raw}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`仪表盘组件 ${widgetId} 的 meta 不是合法 JSON：${detail}`)
  }
  if (parsed === null) return undefined
  if (!isRecord(parsed)) {
    throw new Error(`仪表盘组件 ${widgetId} 的 meta 不是 JSON 对象：${JSON.stringify(parsed)}`)
  }
  return parsed
}

/**
 * 归一化组件输入：以 `base`（已存行）为底做补丁合并，再逐字段校验。
 *
 * @param input - 模型给的组件 JSON（只写想改的字段；新建时给 `type` 等）。
 * @param options.base - 已存行（更新/排版时作底）；省略表示新建。
 * @param options.pageId - 新建时的目标页（`--page-id`）。
 * @param options.requireId - 要求给出 id（更新/排版为真；新建为假）。
 * @returns 可直接交给官方 handler 的行。
 * @throws 未知字段、必填缺失、取值越界或 x/y 只给一个时抛出。
 */
export function buildWidgetRow(
  input: unknown,
  options: { base?: WidgetRow; pageId?: string; requireId?: boolean } = {},
): WidgetInput {
  if (!isRecord(input)) {
    throw new Error(`组件需要 JSON 对象，实际为 ${JSON.stringify(input)?.slice(0, 200)}`)
  }
  for (const key of Object.keys(input)) {
    if (!(WIDGET_FIELDS as readonly string[]).includes(key)) {
      throw new Error(
        `组件字段 ${key} 不是可写字段。可写字段：${WIDGET_FIELDS.join(' / ')}（官方导入格式同此）。`,
      )
    }
  }
  const base = options.base
  const id = input.id ?? base?.id
  const pageId = input.dashboard_page_id ?? options.pageId ?? base?.dashboard_page_id
  const type = input.type ?? base?.type
  const width = input.width ?? base?.width
  const height = input.height ?? base?.height
  const x = input.x ?? base?.x
  const y = input.y ?? base?.y
  if (options.requireId === true && id === undefined) {
    throw new Error('组件字段 id 缺失：更新/排版必须给出已存组件的 id。')
  }
  if (pageId === undefined) {
    throw new Error('组件字段 dashboard_page_id 缺失：请给 --page-id 或在组件 JSON 里给出。')
  }
  if (type === undefined) {
    throw new Error(
      '组件字段 type 缺失：新建组件必须给出服务端认得的组件类型（如 custom-report / markdown-card）。',
    )
  }
  if ((input.x === undefined) !== (input.y === undefined) && base === undefined) {
    throw new Error(
      '组件字段 x/y 要么都省略（由官方自动排版到 12 列网格），要么都给：' +
        '只给一个时官方 schema 会因另一个必填而拒绝。',
    )
  }
  const row: WidgetInput = {
    dashboard_page_id: text(pageId, 'dashboard_page_id'),
    type: text(type, 'type'),
    width: intOf(width, 'width', { min: 1, max: 12 }),
    height: intOf(height, 'height', { min: 1 }),
  }
  if (id !== undefined) row.id = text(id, 'id')
  // x/y 同时缺席时交给官方自动排版（12 列网格），因此绝不能补默认值。
  if (x !== undefined) row.x = intOf(x, 'x', { min: 0, max: 11 })
  if (y !== undefined) row.y = intOf(y, 'y', { min: 0 })
  const meta = input.meta ?? base?.meta
  if (meta !== undefined) {
    if (!isRecord(meta))
      throw new Error(`组件字段 meta 需要 JSON 对象，实际为 ${JSON.stringify(meta)}`)
    row.meta = meta
  }
  return row
}

/** 执行一次 AQL 查询并取 `data` 数组。 */
async function aqlRows(
  access: ActionAccess,
  table: 'dashboard' | 'dashboard_pages',
): Promise<Record<string, unknown>[]> {
  const query = access.api.q(table) as QueryBuilder
  const rows = await access.api.aqlQuery(query.select(['*']))
  const data = (rows as { data?: unknown }).data
  if (!Array.isArray(data)) {
    throw new Error(`读取仪表盘失败：${table} 查询未返回数据数组`)
  }
  return data as Record<string, unknown>[]
}

/** 伴侣 CLI 需要的 api 类型（导出以便测试直接构造访问面）。 */
export type { ActualApiModule }
