/**
 * 报表族动作实现：把解析好的参数变成一次会话内的具体操作与输出。
 *
 * 读写边界：
 * - `list` / `get` / `data` 只读（会话取共享锁，不 sync 回写）；
 * - `create` / `update` / `delete` 走独占锁并在收尾 sync（由 `session.ts` 统一处理）。
 *
 * `data` 支持三种来源：`--report-id`/`--name` 读已存报表、`--definition` 直接给定义、
 * 两者之一再加 `--overrides` 做只读试算——试算结果**不落盘**。
 * @module @dsh-plus/actual-reports/report-commands
 */

import {
  type ActionContext,
  type ActionFlags,
  type ActionResult,
  boolFlag,
  jsonFlag,
  stringFlag,
} from './action.ts'
import { computeReport, type ReportData } from './compute.ts'
import { normalizeReport, type ReportDefinition } from './model.ts'
import { loadFirstDayOfWeek } from './query.ts'
import { renderReportData, renderReports } from './render.ts'
import {
  createReport,
  deleteReport,
  listReports,
  type ReportSelector,
  readReport,
  updateReport,
  type WidgetRef,
} from './report-store.ts'

/** 选择器（id 或名称）。 */
function selectorOf(flags: ActionFlags): ReportSelector {
  const selector: ReportSelector = {}
  const reportId = stringFlag(flags, 'reportId')
  const name = stringFlag(flags, 'name')
  if (reportId !== undefined) selector.reportId = reportId
  if (name !== undefined) selector.name = name
  return selector
}

/** 归一化定义（缺省字段回落官方默认值，非法取值当场报错）。 */
function definitionOf(raw: unknown, today: string, requireName: boolean): ReportDefinition {
  return normalizeReport(raw, { today, requireName })
}

/** 浅合并覆盖字段（数组整体替换，与「只改这几项」的语义一致）。 */
function merged(base: ReportDefinition, overrides: unknown): ReportDefinition {
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    throw new Error('参数 --overrides 需要 JSON 对象（只覆盖给出的字段）')
  }
  return { ...base, ...(overrides as Record<string, unknown>) } as ReportDefinition
}

/** `report list`。 */
async function actionList(context: ActionContext): Promise<ActionResult> {
  const reports = await listReports(context.access)
  return {
    payload: { action: 'report list', reports },
    text: renderReports(reports, context.format),
  }
}

/** `report get`。 */
async function actionGet(context: ActionContext): Promise<ActionResult> {
  const report = await readReport(context.access, selectorOf(context.flags))
  return {
    payload: { action: 'report get', report },
    text: renderReports([report], context.format),
  }
}

/** 组装 `report data` 的载荷（金额单位为分，显式标注）。 */
function dataPayload(report: ReportDefinition, data: ReportData): unknown {
  return {
    action: 'report data',
    report,
    startDate: data.startDate,
    endDate: data.endDate,
    intervals: data.intervals,
    data: data.data,
    intervalData: data.intervalData,
    legend: data.legend,
    totals: {
      assets: data.totalAssets,
      debts: data.totalDebts,
      netAssets: data.netAssets,
      netDebts: data.netDebts,
      totals: data.totalTotals,
    },
    amountUnit: 'cents',
  }
}

/** `report data`。 */
async function actionData(context: ActionContext): Promise<ActionResult> {
  const { access, flags, today } = context
  const rawDefinition = jsonFlag(flags, 'definition')
  const rawOverrides = jsonFlag(flags, 'overrides')
  let report: ReportDefinition
  if (rawDefinition !== undefined) {
    const base = definitionOf(rawDefinition, today, false)
    report =
      rawOverrides === undefined ? base : definitionOf(merged(base, rawOverrides), today, false)
  } else {
    const stored = await readReport(access, selectorOf(flags))
    report =
      rawOverrides === undefined ? stored : definitionOf(merged(stored, rawOverrides), today, false)
  }
  const firstDayOfWeekIdx = await loadFirstDayOfWeek(access)
  const data = await computeReport({
    definition: report,
    today,
    deps: { api: access.api, call: access.call },
    ...(firstDayOfWeekIdx === undefined ? {} : { firstDayOfWeekIdx }),
  })
  return { payload: dataPayload(report, data), text: renderReportData(data, context.format) }
}

/** `report create`。 */
async function actionCreate(context: ActionContext): Promise<ActionResult> {
  const definition = definitionOf(jsonFlag(context.flags, 'definition'), context.today, true)
  const id = await createReport(context.access, definition)
  const stored = await readReport(context.access, { reportId: id })
  return {
    payload: { action: 'report create', id, report: stored },
    text: `已创建报表 ${stored.name}（${id}）\n${renderReports([stored], context.format)}`,
  }
}

/** 给定义钉上已存报表的 id（更新必须带 id，缺了当场报错）。 */
function pinnedTo(definition: ReportDefinition, id: string | undefined): ReportDefinition {
  if (id === undefined || id === '') {
    throw new Error('更新报表需要已知的报表 id：请先用 --report-id 或 --name 选中一张已存报表。')
  }
  return { ...definition, id }
}

/** `report update`。 */
async function actionUpdate(context: ActionContext): Promise<ActionResult> {
  const { access, flags, today } = context
  const stored = await readReport(access, selectorOf(flags))
  const rawDefinition = jsonFlag(flags, 'definition')
  const rawOverrides = jsonFlag(flags, 'overrides')
  if (rawDefinition === undefined && rawOverrides === undefined) {
    throw new Error(
      '需要给出要修改的内容：--definition（整体替换）或 --overrides（只改若干字段）。',
    )
  }
  const base = rawDefinition === undefined ? stored : definitionOf(rawDefinition, today, true)
  const next = pinnedTo(base, stored.id)
  const mergedNext =
    rawOverrides === undefined ? next : definitionOf(merged(next, rawOverrides), today, true)
  const finalDefinition = pinnedTo(mergedNext, stored.id)
  await updateReport(access, finalDefinition)
  const updated = await readReport(access, { reportId: finalDefinition.id ?? '' })
  return {
    payload: { action: 'report update', report: updated },
    text: `已更新报表 ${updated.name}（${updated.id ?? ''}）\n${renderReports([updated], context.format)}`,
  }
}

/** `report delete`。 */
async function actionDelete(context: ActionContext): Promise<ActionResult> {
  const report = await readReport(context.access, selectorOf(context.flags))
  const removed = await deleteReport(context.access, report, {
    force: boolFlag(context.flags, 'force'),
  })
  return { payload: deletePayload(report, removed), text: deleteText(report, removed) }
}

/** 删除结果载荷。 */
function deletePayload(report: ReportDefinition, removed: WidgetRef[]): unknown {
  return { action: 'report delete', id: report.id ?? '', deleted: true, removedWidgets: removed }
}

/** 删除结果文本。 */
function deleteText(report: ReportDefinition, removed: WidgetRef[]): string {
  const extra = removed.length === 0 ? '' : `；同时移除 ${removed.length} 个仪表盘组件`
  return `已删除报表 ${report.name}（${report.id ?? ''}）${extra}`
}

/** 动作表（族内动作名 → 实现）。 */
const HANDLERS: Record<string, (context: ActionContext) => Promise<ActionResult>> = {
  list: actionList,
  get: actionGet,
  data: actionData,
  create: actionCreate,
  update: actionUpdate,
  delete: actionDelete,
}

/**
 * 执行一个报表动作。
 *
 * @param action - 动作名（`list` / `get` / `data` / `create` / `update` / `delete`）。
 * @throws 动作不存在或实现报错时抛出（CLI 层负责转成用户可读输出）。
 */
export async function runReportAction(
  action: string,
  context: ActionContext,
): Promise<ActionResult> {
  const handler = HANDLERS[action]
  if (handler === undefined) {
    throw new Error(`未知的报表动作：${action}。合法动作：${Object.keys(HANDLERS).join(' / ')}。`)
  }
  return await handler(context)
}
