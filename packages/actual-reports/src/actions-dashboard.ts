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
 * @module @dsh-plus/actual-reports/actions-dashboard
 */

import type { FamilySpec } from './family.ts'

const WIDGET_TYPES =
  'net-worth-card / cash-flow-card / spending-card / crossover-card / budget-analysis-card / ' +
  'markdown-card / summary-card / calendar-card / formula-card / custom-report / sankey-card / ' +
  'balance-forecast-card / age-of-money-card / monte-carlo-card'

/** 组件 JSON 的字段说明（`--widget` 的取值形状）。 */
const WIDGET_DOC =
  '组件 JSON（字段名与官方导入/导出格式一致）：type（组件类型，见工具描述）；' +
  'width/height（整数，width 取 1–12 的 12 列网格）；x/y（可选整数，都省略时官方自动排版，' +
  '只给一个会被官方 schema 拒绝）；meta（对象，形状随类型而变：报表组件固定为 {"id":"<报表 id>"}，' +
  'markdown-card 为 {"content":"…"}，其余类型先用 `widgets` 读现场同类组件照抄）。' +
  '修改组件时只需给 id + 要改的字段（补丁语义），未给的字段沿用现值。'

/** 仪表盘族。 */
export const DASHBOARD_FAMILY: FamilySpec = {
  family: 'dashboard',
  summary:
    'Actual Budget 仪表盘：读取页面与组件、新建/重命名/删除页面、增删改与复制组件、调整排版。' +
    `服务端认得的组件类型：${WIDGET_TYPES}。`,
  guidance:
    '页面用 list 读，组件用 widgets 读；改组件前先读同类组件，照抄它的 meta 形状再改（meta 随类型而变，不要凭猜）。' +
    '报表组件（custom-report）的 meta 固定为 {"id":"<报表 id>"}，id 用 report 工具 list 取：这是「把一张自定义报表放上仪表盘」的唯一路径。' +
    'add-widget 省略 x/y 时官方自动排版（12 列网格）；layout 只改几何；update-widget 是补丁语义（只给要改的字段，未给的沿用现值）。' +
    '删除页面会连带删除该页全部组件（官方拒绝删除最后一个页面）；reset 是把该页恢复成官方默认组件集，不是清空。',

  actions: [
    {
      action: 'list',
      summary: '列出全部仪表盘页面与每页组件（报表组件会解析出被引用报表的名字与失效标记）。',
      readOnly: true,
      args: [],
      output: '{"action":"dashboard list","pages":[{"id","name","widgets":[…]}]}',
    },
    {
      action: 'widgets',
      summary: '列出组件（给 --page-id 只列该页）；组件行字段与官方导入/导出格式一致。',
      readOnly: true,
      args: [
        {
          prop: 'pageId',
          flag: 'page-id',
          type: 'string',
          description: '仪表盘页面 id（用 `dashboard list` 取）。省略则列出全部页面的组件。',
        },
      ],
      output: '{"action":"dashboard widgets","pageId","widgets":[…]},',
    },
    {
      action: 'create',
      summary: '新建一个仪表盘页面。',
      readOnly: false,
      args: [
        {
          prop: 'name',
          flag: 'name',
          type: 'string',
          required: true,
          description: '新页面名称（允许与已有页面重名，官方不做唯一性校验）。',
        },
      ],
      output: '{"action":"dashboard create","page":{"id","name"},"pages":[…]},',
    },
    {
      action: 'rename',
      summary: '重命名一个仪表盘页面。',
      readOnly: false,
      args: [
        {
          prop: 'pageId',
          flag: 'page-id',
          type: 'string',
          required: true,
          description: '要改名的页面 id。',
        },
        { prop: 'name', flag: 'name', type: 'string', required: true, description: '新名称。' },
      ],
      output: '{"action":"dashboard rename","page":{…},"pages":[…]},',
    },
    {
      action: 'delete',
      summary: '删除一个仪表盘页面及其全部组件（官方拒绝删除最后一个页面）。',
      readOnly: false,
      args: [
        {
          prop: 'pageId',
          flag: 'page-id',
          type: 'string',
          required: true,
          description: '要删除的页面 id（该页组件会一并移除）。',
        },
      ],
      output: '{"action":"dashboard delete","pageId","removedWidgets":n,"pages":[…]},',
    },
    {
      action: 'reset',
      summary: '把一个页面的组件重置为官方默认组件集（不是清空成白板；已建的报表组件不会回来）。',
      readOnly: false,
      args: [
        {
          prop: 'pageId',
          flag: 'page-id',
          type: 'string',
          required: true,
          description: '要重置的页面 id。',
        },
      ],
      output: '{"action":"dashboard reset","pageId","widgets":[…]},',
    },
    {
      action: 'add-widget',
      summary: '在页面上新建组件；x/y 同时省略时由官方自动排版到 12 列网格。',
      readOnly: false,
      args: [
        {
          prop: 'pageId',
          flag: 'page-id',
          type: 'string',
          required: true,
          description: '目标页面 id。',
        },
        {
          prop: 'widget',
          flag: 'widget',
          type: 'json',
          required: true,
          description: WIDGET_DOC,
        },
      ],
      output: '{"action":"dashboard add-widget","pageId","widget":{…}},',
    },
    {
      action: 'update-widget',
      summary: '修改一个已存组件（补丁语义：只给要改的字段）。',
      readOnly: false,
      args: [
        {
          prop: 'widget',
          flag: 'widget',
          type: 'json',
          required: true,
          description: `必须含 id；${WIDGET_DOC}`,
        },
      ],
      output: '{"action":"dashboard update-widget","widget":{…}},',
    },
    {
      action: 'remove-widget',
      summary: '删除一个组件（组件不存在时报错，不静默成功）。',
      readOnly: false,
      args: [
        {
          prop: 'widgetId',
          flag: 'widget-id',
          type: 'string',
          required: true,
          description: '要删除的组件 id（用 `dashboard widgets` 取）。',
        },
      ],
      output: '{"action":"dashboard remove-widget","widgetId","removed":{…}},',
    },
    {
      action: 'copy-widget',
      summary: '把组件复制到另一个页面（新组件由官方自动排版）。',
      readOnly: false,
      args: [
        {
          prop: 'widgetId',
          flag: 'widget-id',
          type: 'string',
          required: true,
          description: '源组件 id。',
        },
        {
          prop: 'targetPageId',
          flag: 'target-page-id',
          type: 'string',
          required: true,
          description: '目标页面 id（用 `dashboard list` 取）。',
        },
      ],
      output: '{"action":"dashboard copy-widget","sourceWidgetId","targetPageId","widget":{…}},',
    },
    {
      action: 'layout',
      summary: '批量调整某页组件的排版（只改 x/y/width/height）。',
      readOnly: false,
      args: [
        {
          prop: 'pageId',
          flag: 'page-id',
          type: 'string',
          required: true,
          description: '目标页面 id。',
        },
        {
          prop: 'layout',
          flag: 'layout',
          type: 'json',
          required: true,
          description:
            'JSON 数组，每项 {"id":"<组件 id>","x":0,"y":0,"width":4,"height":2}；' +
            '只接受 id/x/y/width/height，未给的几何字段沿用现值。',
        },
      ],
      output: '{"action":"dashboard layout","pageId","widgets":[…]},',
    },
  ],
}
