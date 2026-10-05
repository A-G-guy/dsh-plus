/**
 * 命令族契约：选项、动作与族的形状，以及按名查找。
 *
 * 各族（`actions-report.ts` / `actions-dashboard.ts` / `actions-reference.ts`）只提供
 * 数据，形状与查找规则集中在这里，保证「一个族的定义方式只有一种」。
 * @module @dsh-plus/actual-reports/family
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
  /**
   * 是否需要打开预算（默认 true）。
   *
   * `false` = 只读本机/服务端资产，不加载官方 api、不取锁、不下载预算——
   * 查组件字段这类动作不该为此付一次同步的代价。
   */
  needsBudget?: boolean
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

/** 族内按动作名取动作。 */
export function findAction(family: FamilySpec, action: string): ActionSpec | undefined {
  return family.actions.find((item) => item.action === action)
}

/** 该动作是否为 JSON 取值选项。 */
export function isJsonOption(spec: OptionSpec): boolean {
  return spec.type === 'json'
}
