/**
 * 动作表：本 CLI 的**唯一事实来源**——argv 解析、帮助文本、以及暴露给 DSH/MCP 的
 * 工具 schema 全部由这张表派生，三者不可能漂移。
 *
 * 约定：
 * - 每个 action 一个子命令，参数一律用长选项（不做位置参数，避免歧义与越界解析）；
 * - `--definition` / `--overrides` 收 JSON 字符串（`@file` 形式可从文件读取，
 *   由 `cli.ts` 在读取层展开）；
 * - `readOnly` 只描述「不改预算数据」，用于审批判定；写动作必须显式标注。
 * @module @dsh-plus/actual-reports/actions
 */

/** 选项取值类型（决定 argv 解析与工具 schema 的 JSON 类型）。 */
export type OptionType = 'string' | 'boolean' | 'json'

/** 一个选项。 */
export interface OptionSpec {
  /** 模型可见的参数名（camelCase）。 */
  prop: string
  /** 命令行长选项名（kebab-case，不带 `--`）。 */
  flag: string
  type: OptionType
  /** 必填（缺失即报错）。 */
  required?: boolean
  /** 面向模型的说明（会进工具 schema 与帮助文本）。 */
  description: string
}

/** 一个动作。 */
export interface ActionSpec {
  action: string
  summary: string
  /** 只读（不写预算）。 */
  readOnly: boolean
  args: readonly OptionSpec[]
  /** 输出形状说明（进帮助文本，便于人机对齐）。 */
  output: string
}

/** 一个命令族（= 一个 DSH/MCP 工具）。 */
export interface FamilySpec {
  family: string
  summary: string
  /** 面向模型的族级使用建议（进工具描述，写「怎么用」而不是复述参数表）。 */
  guidance: string
  actions: readonly ActionSpec[]
}

/** 报表选择：id 或名称二选一（运行期强制）。 */
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

/**
 * 服务端认得的组件类型（读自本机 API 的 `isWidgetType` 校验表）。
 *
 * 只进工具描述、不做校验：类型表随服务端版本变化，硬校验等于把版本定死；
 * 写错类型的后果是界面显示「未知组件」，而 `copy-widget` 会由官方显式报错。
 */
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

/** 全部命令族（= 暴露给模型的全部工具）。 */
export const FAMILIES: readonly FamilySpec[] = [REPORT_FAMILY, DASHBOARD_FAMILY]

/** 按族取动作表。 */
export function findFamily(family: string): FamilySpec | undefined {
  return FAMILIES.find((item) => item.family === family)
}

/** 族内按动作名取动作。 */
export function findAction(family: FamilySpec, action: string): ActionSpec | undefined {
  return family.actions.find((item) => item.action === action)
}

/** 该动作是否为 JSON 取值选项。 */
export function isJsonOption(spec: OptionSpec): boolean {
  return spec.type === 'json'
}
