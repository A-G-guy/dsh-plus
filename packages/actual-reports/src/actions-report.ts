/**
 * 动作表：本 CLI 的**唯一事实来源**——argv 解析、帮助文本、以及暴露给 DSH/MCP 的
 * 工具 schema 全部由这张表派生，三者不可能漂移。
 *
 * 约定：
 * - 每个 action 一个子命令，参数一律用长选项（不做位置参数，避免歧义与越界解析）；
 * - `--definition` / `--overrides` 收 JSON 字符串（`@file` 形式可从文件读取，
 *   由 `cli.ts` 在读取层展开）；
 * - `readOnly` 只描述「不改预算数据」，用于审批判定；写动作必须显式标注。
 * - `needsBudget: false` 的动作只读本机/服务端资产，不打开预算。
 * @module @dsh-plus/actual-reports/actions-report
 */

import type { FamilySpec, OptionSpec } from './family.ts'

const REPORT_SELECTOR: readonly OptionSpec[] = [
  {
    prop: 'reportId',
    flag: 'report-id',
    type: 'string',
    description: '报表 id（用 `report list` 取）。与 name 二选一。',
  },
  {
    prop: 'name',
    flag: 'name',
    type: 'string',
    description: '报表名称（在预算内唯一）。与 reportId 二选一。',
  },
]

/** 报表定义的字段说明（`--definition` 的取值形状）。 */
const DEFINITION_DOC =
  '报表定义 JSON，字段与官方界面一致：name；isDateStatic + startDate/endDate 或 dateRange；' +
  'interval（Daily/Weekly/Monthly/Yearly）；groupBy（Category/Group/CategoryGroup/Payee/Account/Interval）；' +
  'balanceType（Payment/Deposit/Net/Net Payment/Net Deposit）；sortBy（Ascending/Descending/Name/Budget）；' +
  'mode（total/time，仅影响展示）；showEmpty/showOffBudget/showHiddenCategories/showUncategorized/' +
  'trimIntervals/showTrendLines/includeCurrentInterval；graphType；conditions（官方规则条件数组）；conditionsOp（and/or）。'

/** 报表族。 */
export const REPORT_FAMILY: FamilySpec = {
  family: 'report',
  summary: 'Actual Budget 自定义报表：读取定义、按官方口径计算数据、创建/修改/删除报表。',
  guidance:
    '读取已保存报表用 list/get；要具体数字用 data（本地按官方口径计算，不需要打开界面）；新建/修改/删除用 create/update/delete。' +
    'data 输出 data（每个系列的合计与逐区间明细）与 intervalData（逐区间合计，series 里是各系列金额）；' +
    '所有金额都是**整数分**（amountUnit: "cents"），不要当元；逐区间键是区间起点（月为 yyyy-MM、年为 yyyy、日/周为 yyyy-MM-dd）。' +
    '用 reportId 定位最稳（list 里能拿到）；name 只作补充，重名会被拒绝。',
  actions: [
    {
      action: 'list',
      summary: '列出该预算里全部已保存的自定义报表（含完整定义）。',
      readOnly: true,
      args: [],
      output: '{ reports: ReportDefinition[] }',
    },
    {
      action: 'get',
      summary: '按 id 或名称取一张报表的完整定义。',
      readOnly: true,
      args: REPORT_SELECTOR,
      output: '{ report: ReportDefinition }',
    },
    {
      action: 'data',
      summary:
        '按官方口径算出报表数据（本地计算，不依赖界面）：系列合计、逐区间明细、图例与总计。' +
        '可给已存报表加 --overrides 做「只读试算」，不落盘。',
      readOnly: true,
      args: [
        ...REPORT_SELECTOR,
        {
          prop: 'definition',
          flag: 'definition',
          type: 'json',
          description: `直接给定义算数据（不读已存报表）。${DEFINITION_DOC}`,
        },
        {
          prop: 'overrides',
          flag: 'overrides',
          type: 'json',
          description: '在选中报表（或 --definition）之上覆盖若干字段后试算，不写回预算。',
        },
        {
          prop: 'today',
          flag: 'today',
          type: 'string',
          description:
            '把「今天」当成指定日期（yyyy-MM-dd），用于复现实时区间的结果；默认取真实日期。',
        },
      ],
      output:
        '{ report, startDate, endDate, intervals, data, intervalData, legend, totals, amountUnit: "cents" }；' +
        'data 为系列数组（每个系列含逐区间明细），intervalData 为逐区间合计及其 series 金额。',
    },
    {
      action: 'create',
      summary: '新建一张自定义报表（name 必填且在本预算内唯一）。',
      readOnly: false,
      args: [
        {
          prop: 'definition',
          flag: 'definition',
          type: 'json',
          required: true,
          description: `要创建的报表定义。${DEFINITION_DOC}`,
        },
      ],
      output: '{ id, report }',
    },
    {
      action: 'update',
      summary: '更新已存报表：给 --definition 整体替换，或给 --overrides 只改若干字段。',
      readOnly: false,
      args: [
        ...REPORT_SELECTOR,
        {
          prop: 'definition',
          flag: 'definition',
          type: 'json',
          description: `新的完整定义（缺省字段回落官方默认值）。${DEFINITION_DOC}`,
        },
        {
          prop: 'overrides',
          flag: 'overrides',
          type: 'json',
          description: '只覆盖这些字段（与已存定义合并）；与 --definition 二选一。',
        },
      ],
      output: '{ report }',
    },
    {
      action: 'delete',
      summary:
        '删除一张报表。若它正被仪表盘组件引用，会被拒绝；确认要连带移除这些组件时加 --force。',
      readOnly: false,
      args: [
        ...REPORT_SELECTOR,
        {
          prop: 'force',
          flag: 'force',
          type: 'boolean',
          description: '即使被仪表盘组件引用也删除（同时移除这些组件）。',
        },
      ],
      output: '{ id, deleted: true, removedWidgets: Array<{ pageId, widgetId }> }',
    },
  ],
}
