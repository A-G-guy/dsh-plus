/**
 * 仪表盘族动作实现：页面与组件的增删改查。
 *
 * 读写边界：
 * - `list` / `widgets` 只读（共享锁，不回写）；
 * - 其余动作走独占锁并在收尾 sync（由 `session.ts` 统一处理）。
 *
 * 「先读后写」是本族的固定套路：官方 handler 对不存在的目标静默成功
 * （`dashboard-add-widget` 必填字段缺失、`dashboard-remove-widget` 删不存在的 id
 * 都不报错），所以每个写动作都先读现场做校验，写完再读回，把结果交给模型核对。
 *
 * 组件 `meta` 的形状随类型而变，本族不做二次编造：模型先用 `widgets` 读现场
 * 同类组件的 meta，照抄后改字段即可（报表组件例外，其形状固定为 `{"id":"…"}`）。
 * @module @dsh-plus/actual-reports/dashboard-commands
 */

import {
  type ActionContext,
  type ActionResult,
  jsonFlag,
  requireStringFlag,
  stringFlag,
} from './action.ts'
import {
  buildWidgetRow,
  type DashboardPage,
  listPages,
  listWidgets,
  requirePage,
  requireWidget,
  type WidgetRow,
} from './dashboard-store.ts'
import { renderDashboard, renderWidgetLine } from './render.ts'
import { listReports } from './report-store.ts'

/** 按页分组的页面视图（读取用）。 */
interface PageView extends DashboardPage {
  widgets: WidgetRow[]
}

/** 读现场：页面 + 组件 + 报表名表。 */
async function sceneOf(context: ActionContext): Promise<{
  pages: DashboardPage[]
  widgets: WidgetRow[]
  reportNames: Map<string, string>
}> {
  const pages = await listPages(context.access)
  const widgets = await listWidgets(context.access)
  const reports = await listReports(context.access)
  const reportNames = new Map<string, string>()
  for (const report of reports) {
    if (report.id !== undefined) reportNames.set(report.id, report.name)
  }
  return { pages, widgets, reportNames }
}

/** 组件 → 机器面载荷：报表组件补上被引用报表的名字（引用失效时显式标注）。 */
function annotate(widget: WidgetRow, reportNames: Map<string, string>): Record<string, unknown> {
  if (widget.type !== 'custom-report') return { ...widget }
  const referenced = typeof widget.meta?.id === 'string' ? widget.meta.id : ''
  return {
    ...widget,
    reportId: referenced,
    reportName: reportNames.get(referenced) ?? null,
    missingReport: !reportNames.has(referenced),
  }
}

/** 按页分组。 */
function groupByPage(pages: DashboardPage[], widgets: WidgetRow[]): PageView[] {
  return pages.map((page) => ({
    ...page,
    widgets: widgets.filter((widget) => widget.dashboard_page_id === page.id),
  }))
}

/** 读取一组组件中该页的部分。 */
function widgetsOfPage(widgets: WidgetRow[], pageId: string): WidgetRow[] {
  return widgets.filter((widget) => widget.dashboard_page_id === pageId)
}

/** 列表：页面 + 组件 + 引用解析。 */
async function listAction(context: ActionContext): Promise<ActionResult> {
  const { pages, widgets, reportNames } = await sceneOf(context)
  const grouped = groupByPage(pages, widgets)
  const payload = {
    action: 'dashboard list',
    pages: grouped.map((page) => ({
      id: page.id,
      name: page.name,
      widgets: page.widgets.map((widget) => annotate(widget, reportNames)),
    })),
  }
  return { payload, text: renderDashboard(grouped, reportNames, context.format) }
}

/** 单页组件读取。 */
async function widgetsAction(context: ActionContext): Promise<ActionResult> {
  const { pages, widgets, reportNames } = await sceneOf(context)
  const pageId = stringFlag(context.flags, 'pageId')
  if (pageId !== undefined) requirePage(pages, pageId)
  const selected = pageId === undefined ? widgets : widgetsOfPage(widgets, pageId)
  const payload = {
    action: 'dashboard widgets',
    pageId: pageId ?? null,
    widgets: selected.map((widget) => annotate(widget, reportNames)),
  }
  const grouped = groupByPage(pageId === undefined ? pages : [requirePage(pages, pageId)], selected)
  return { payload, text: renderDashboard(grouped, reportNames, context.format) }
}

/** 新建页面。 */
async function createAction(context: ActionContext): Promise<ActionResult> {
  const name = requireStringFlag(context.flags, 'name')
  const pageId = await context.access.call('dashboard-create', { name })
  if (typeof pageId !== 'string' || pageId === '') {
    throw new Error(
      `dashboard-create 未返回新页面 id（实际：${JSON.stringify(pageId)?.slice(0, 200)}）`,
    )
  }
  const pages = await listPages(context.access)
  const page = requirePage(pages, pageId)
  return {
    payload: { action: 'dashboard create', page, pages },
    text: `已新建仪表盘页面 ${page.name}(${page.id})。`,
  }
}

/** 重命名页面。 */
async function renameAction(context: ActionContext): Promise<ActionResult> {
  const pageId = requireStringFlag(context.flags, 'pageId')
  const name = requireStringFlag(context.flags, 'name')
  requirePage(await listPages(context.access), pageId)
  await context.access.call('dashboard-rename', { id: pageId, name })
  const pages = await listPages(context.access)
  const page = requirePage(pages, pageId)
  return {
    payload: { action: 'dashboard rename', page, pages },
    text: `已把页面重命名为 ${page.name}(${page.id})。`,
  }
}

/** 删除页面（官方拒绝删除最后一个页面）。 */
async function deleteAction(context: ActionContext): Promise<ActionResult> {
  const pageId = requireStringFlag(context.flags, 'pageId')
  const pages = await listPages(context.access)
  const page = requirePage(pages, pageId)
  const removed = widgetsOfPage(await listWidgets(context.access, pageId), pageId).length
  await context.access.call('dashboard-delete', pageId)
  const remaining = await listPages(context.access)
  return {
    payload: {
      action: 'dashboard delete',
      pageId,
      name: page.name,
      removedWidgets: removed,
      pages: remaining,
    },
    text: `已删除页面 ${page.name}(${pageId})，同时移除 ${removed} 个组件；剩余 ${remaining.length} 个页面。`,
  }
}

/** 重置页面组件（官方语义：清空后恢复默认组件集，不是清空成白板）。 */
async function resetAction(context: ActionContext): Promise<ActionResult> {
  const pageId = requireStringFlag(context.flags, 'pageId')
  const pages = await listPages(context.access)
  const page = requirePage(pages, pageId)
  await context.access.call('dashboard-reset', pageId)
  const widgets = await listWidgets(context.access, pageId)
  const reportNames = new Map<string, string>()
  return {
    payload: {
      action: 'dashboard reset',
      pageId,
      widgets: widgets.map((widget) => annotate(widget, reportNames)),
    },
    text: `已把页面 ${page.name}(${pageId}) 重置为官方默认组件集，现有 ${widgets.length} 个组件。`,
  }
}

/** 新建组件（x/y 同时省略时由官方自动排版）。 */
async function addWidgetAction(context: ActionContext): Promise<ActionResult> {
  const pageId = requireStringFlag(context.flags, 'pageId')
  const pages = await listPages(context.access)
  requirePage(pages, pageId)
  const row = buildWidgetRow(jsonFlag(context.flags, 'widget'), { pageId })
  const before = new Set((await listWidgets(context.access, pageId)).map((widget) => widget.id))
  await context.access.call('dashboard-add-widget', row)
  const existing = widgetsOfPage(await listWidgets(context.access, pageId), pageId)
  const created = createdOf(existing, before)
  return {
    payload: { action: 'dashboard add-widget', pageId, widget: created },
    text: `已在页面 ${pageId} 新建组件：\n${renderWidgetLine(created)}`,
  }
}

/** 从「写前 id 集合」里找出新建的那一行（官方 handler 不回传新 id）。 */
function createdOf(existing: WidgetRow[], before: Set<string>): WidgetRow {
  const created = existing.filter((widget) => !before.has(widget.id))
  if (created.length !== 1) {
    throw new Error(
      `写入后未能唯一定位新组件（新增 ${created.length} 个，id：${created.map((item) => item.id).join('、') || '无'}）。` +
        '请用 `dashboard widgets` 复核现场。',
    )
  }
  return created[0] as WidgetRow
}

/** 修改组件（补丁语义：只写要改的字段，其余沿用已存行）。 */
async function updateWidgetAction(context: ActionContext): Promise<ActionResult> {
  const input = jsonFlag(context.flags, 'widget')
  const widgetId =
    typeof input === 'object' && input !== null ? (input as { id?: unknown }).id : undefined
  if (typeof widgetId !== 'string' || widgetId === '') {
    throw new Error(
      '修改组件需要已存组件的 id：请先用 `dashboard widgets` 取，再在 --widget 里带上 id。',
    )
  }
  const current = requireWidget(await listWidgets(context.access), widgetId)
  const row = buildWidgetRow(input, { base: current, requireId: true })
  await context.access.call('dashboard-update-widget', row)
  const updated = requireWidget(
    await listWidgets(context.access, current.dashboard_page_id),
    widgetId,
  )
  return {
    payload: { action: 'dashboard update-widget', widget: updated },
    text: `已更新组件 ${widgetId}：\n${renderWidgetLine(updated)}`,
  }
}

/** 删除组件（官方删不存在的 id 会静默成功，故先校验存在）。 */
async function removeWidgetAction(context: ActionContext): Promise<ActionResult> {
  const widgetId = requireStringFlag(context.flags, 'widgetId')
  const widgets = await listWidgets(context.access)
  const widget = requireWidget(widgets, widgetId)
  await context.access.call('dashboard-remove-widget', widgetId)
  return {
    payload: { action: 'dashboard remove-widget', widgetId, removed: widget },
    text: `已删除组件 ${widget.type}(${widgetId})。`,
  }
}

/** 复制组件到另一页（新组件由官方自动排版）。 */
async function copyWidgetAction(context: ActionContext): Promise<ActionResult> {
  const widgetId = requireStringFlag(context.flags, 'widgetId')
  const targetPageId = requireStringFlag(context.flags, 'targetPageId')
  const pages = await listPages(context.access)
  requirePage(pages, targetPageId)
  const source = requireWidget(await listWidgets(context.access), widgetId)
  const before = new Set((await listWidgets(context.access, targetPageId)).map((item) => item.id))
  await context.access.call('dashboard-copy-widget', {
    id: widgetId,
    targetDashboardPageId: targetPageId,
  })
  const created = createdOf(await listWidgets(context.access, targetPageId), before)
  return {
    payload: {
      action: 'dashboard copy-widget',
      sourceWidgetId: widgetId,
      sourcePageId: source.dashboard_page_id,
      targetPageId,
      widget: created,
    },
    text: `已把 ${source.type}(${widgetId}) 复制到页面 ${targetPageId}：\n${renderWidgetLine(created)}`,
  }
}

/** 排版：只改几何字段（x/y/width/height），其余字段沿用已存行。 */
async function layoutAction(context: ActionContext): Promise<ActionResult> {
  const pageId = requireStringFlag(context.flags, 'pageId')
  const pages = await listPages(context.access)
  requirePage(pages, pageId)
  const layout = jsonFlag(context.flags, 'layout')
  if (!Array.isArray(layout)) {
    throw new Error(`--layout 需要 JSON 数组，每项形如 {"id":"…","x":0,"y":0,"width":4,"height":2}`)
  }
  const current = widgetsOfPage(await listWidgets(context.access, pageId), pageId)
  const rows = layout.map((entry) => layoutRow(entry, current))
  // 只下发几何字段：官方的 dashboard-update 走低层 update()（按字段补丁写 CRDT），
  // 带上 meta 反而会绕过 schema 转换、去碰界面写下的那份 meta。
  await context.access.call(
    'dashboard-update',
    rows.map((row) => ({
      id: row.id,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
    })),
  )
  const widgets = widgetsOfPage(await listWidgets(context.access, pageId), pageId)
  return {
    payload: { action: 'dashboard layout', pageId, widgets },
    text: `已更新页面 ${pageId} 的排版（${rows.length} 个组件）。`,
  }
}

/**
 * 单条排版项 → 校验过的组件行（校验用完整行，下发时只取几何字段）。
 * @throws 多给字段、缺 id、未知 id 或几何取值越界时抛出。
 */
function layoutRow(entry: unknown, current: WidgetRow[]): WidgetRow {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(
      `--layout 的每一项都需要 JSON 对象，实际为 ${JSON.stringify(entry)?.slice(0, 120)}`,
    )
  }
  const patch = entry as Record<string, unknown>
  const allowed = new Set(['id', 'x', 'y', 'width', 'height'])
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new Error(
        `--layout 只接受 id/x/y/width/height（多出 ${key}）；改类型或 meta 请用 update-widget。`,
      )
    }
  }
  const id = patch.id
  if (typeof id !== 'string' || id === '') {
    throw new Error('--layout 的每一项都需要已存组件的 id。')
  }
  const base = requireWidget(current, id)
  // buildWidgetRow 的输出带可选 id；base 已保证有 id，故这里断言式取回。
  return { ...base, ...buildWidgetRow(patch, { base, requireId: true }), id } as WidgetRow
}

/** 动作表。 */
const HANDLERS: Record<string, (context: ActionContext) => Promise<ActionResult>> = {
  list: listAction,
  widgets: widgetsAction,
  create: createAction,
  rename: renameAction,
  delete: deleteAction,
  reset: resetAction,
  'add-widget': addWidgetAction,
  'update-widget': updateWidgetAction,
  'remove-widget': removeWidgetAction,
  'copy-widget': copyWidgetAction,
  layout: layoutAction,
}

/**
 * 执行一个仪表盘动作。
 * @throws 未知动作时报错并列出合法动作。
 */
export async function runDashboardAction(
  action: string,
  context: ActionContext,
): Promise<ActionResult> {
  const handler = HANDLERS[action]
  if (handler === undefined) {
    throw new Error(`未知的仪表盘动作：${action}。合法动作：${Object.keys(HANDLERS).join(' / ')}。`)
  }
  return await handler(context)
}
