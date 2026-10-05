/**
 * 输出渲染：JSON 是机器面（金额保持整数分，绝不格式化），table/csv 只服务人眼
 * （金额转成货币单位、对齐成表）。
 *
 * 「JSON 保持分」是硬约定：官方界面与数据库都以分为单位，一旦在机器面做除法就会
 * 引入浮点误差，模型再做汇总就会越算越偏；`amountUnit: "cents"` 字段明确标注单位。
 * @module @dsh-plus/actual-reports/render
 */

import type { ReportData } from './compute.ts'
import type { ReportDefinition } from './model.ts'

/** 输出格式。 */
export type OutputFormat = 'json' | 'table' | 'csv'

/** JSON 渲染（2 空格缩进，便于人读与模型解析）。 */
export function renderJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2)
}

/** 分 → 货币单位文本（仅用于人读格式）。 */
export function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** 渲染固定列宽表格。 */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  )
  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd()
  return [
    line(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(line),
  ].join('\n')
}

/** CSV 单元格转义（RFC 4180）。 */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** 渲染 CSV。 */
export function renderCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

/** 报表定义的概览行。 */
function definitionRow(report: ReportDefinition): string[] {
  return [
    report.id ?? '',
    report.name,
    report.mode,
    report.groupBy,
    report.interval,
    report.balanceType,
    report.isDateStatic ? `${report.startDate}~${report.endDate}` : report.dateRange,
  ]
}

/** 定义概览表的表头。 */
const DEFINITION_HEADERS = ['id', 'name', 'mode', 'groupBy', 'interval', 'balanceType', 'range']

/** 渲染报表定义列表（list/get/create/update 共用）。 */
export function renderReports(reports: ReportDefinition[], format: OutputFormat): string {
  if (format === 'csv') {
    return renderCsv(DEFINITION_HEADERS, reports.map(definitionRow))
  }
  return renderTable(DEFINITION_HEADERS, reports.map(definitionRow))
}

/** 系列合计表（含表头与行）。 */
function seriesTable(data: ReportData): { headers: string[]; rows: string[][] } {
  return {
    headers: ['series', 'assets', 'debts', 'netAssets', 'netDebts', 'totals'],
    rows: data.data.map((item) => [
      item.id === '' ? item.name : `${item.name} (${item.id})`,
      formatAmount(item.totalAssets),
      formatAmount(item.totalDebts),
      formatAmount(item.netAssets),
      formatAmount(item.netDebts),
      formatAmount(item.totalTotals),
    ]),
  }
}

/** 逐区间合计表（含表头与行）。 */
function intervalTable(data: ReportData): { headers: string[]; rows: string[][] } {
  return {
    headers: ['interval', 'assets', 'debts', 'netTotals'],
    rows: data.intervalData.map((item) => [
      item.key,
      formatAmount(item.totalAssets),
      formatAmount(item.totalDebts),
      formatAmount(item.totalTotals),
    ]),
  }
}

/** 渲染报表计算结果（data 动作）。 */
export function renderReportData(data: ReportData, format: OutputFormat): string {
  const series = seriesTable(data)
  if (format === 'csv') return renderCsv(series.headers, series.rows)
  const interval = intervalTable(data)
  const header = [
    `报表：${data.definition.name}`,
    `区间：${data.startDate} ~ ${data.endDate}（粒度 ${data.definition.interval}，分组 ${data.definition.groupBy}，口径 ${data.definition.balanceType}）`,
    `总计：assets=${formatAmount(data.totalAssets)} debts=${formatAmount(data.totalDebts)} net=${formatAmount(data.totalTotals)}`,
    '（金额已按货币单位显示；JSON 输出为整数分）',
  ].join('\n')
  return [
    header,
    '',
    '【系列合计】',
    renderTable(series.headers, series.rows),
    '',
    '【逐区间合计】',
    renderTable(interval.headers, interval.rows),
  ].join('\n')
}

/** 组件行（结构对齐 dashboard-store 的 WidgetRow，单向依赖：渲染层是叶子）。 */
export interface RenderWidget {
  id: string
  dashboard_page_id: string
  type: string
  width?: number
  height?: number
  x?: number
  y?: number
  meta?: Record<string, unknown>
  [key: string]: unknown
}

/** 一页仪表盘（含该页组件）。 */
export interface RenderPage {
  id: string
  name: string
  widgets: readonly RenderWidget[]
}

/** meta 单行摘要：报表组件显示被引用的报表，其余显示内容片段。 */
function metaSummary(widget: RenderWidget, reportNames: Map<string, string>): string {
  const meta = widget.meta
  if (meta === undefined) return ''
  if (widget.type === 'custom-report') {
    const id = typeof meta.id === 'string' ? meta.id : ''
    const name = reportNames.get(id)
    return name === undefined ? `报表 ${id || '?'}（引用已失效）` : `报表「${name}」`
  }
  const text = JSON.stringify(meta) ?? ''
  return text.length > 60 ? `${text.slice(0, 57)}...` : text
}

/** 组件单行描述（新建/更新后的回执用）。 */
export function renderWidgetLine(widget: RenderWidget): string {
  const geometry = `${widget.width ?? '?'}×${widget.height ?? '?'} @${widget.x ?? '?'},${widget.y ?? '?'}`
  const meta = widget.meta === undefined ? '' : ` meta=${JSON.stringify(widget.meta)}`
  return `  ${widget.type}(${widget.id}) ${geometry} 页面=${widget.dashboard_page_id}${meta}`
}

/**
 * 仪表盘的人面文本（table：按页分节；csv：一组件一行）。
 *
 * @param pages - 页面与该页组件。
 * @param reportNames - 报表 id → 名称（解析 `custom-report` 组件的引用）。
 * @param format - 输出格式（json 由调用方序列化载荷，不走这里）。
 */
export function renderDashboard(
  pages: readonly RenderPage[],
  reportNames: Map<string, string>,
  format: OutputFormat,
): string {
  const rows = pages.flatMap((page) =>
    page.widgets.map((widget) => [
      page.name,
      page.id,
      widget.id,
      widget.type,
      `${widget.x ?? '?'},${widget.y ?? '?'}`,
      `${widget.width ?? '?'}×${widget.height ?? '?'}`,
      metaSummary(widget, reportNames),
    ]),
  )
  const headers = ['页面', '页面id', '组件id', '类型', '位置', '尺寸', 'meta']
  if (format === 'csv') return renderCsv(headers, rows)
  const sections = pages.map((page) => {
    const own = rows.filter((row) => row[1] === page.id)
    const body =
      own.length === 0
        ? '  （该页还没有组件）'
        : renderTable(headers, own)
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n')
    return `【页面】${page.name}(${page.id}) 共 ${own.length} 个组件\n${body}`
  })
  return [`共 ${pages.length} 个页面。`, ...sections].join('\n\n')
}
