/**
 * 能力描述符：把 `actions.ts` 的动作表编译成「可直接挂进能力目录」的工具描述
 * （名字、描述、JSON Schema、执行计划）。
 *
 * 为什么把 schema 也放在本包：工具 schema 与 argv 解析必须同源——两边各写一份
 * 迟早漂移成「schema 允许但 CLI 不认」的假能力；因此这里由同一张动作表生成，
 * 上层（`@dsh-plus/actual-mcp`）只做搬运与执行。
 *
 * `definition` / `overrides` 这类 json 选项在 schema 里是**对象**（模型写结构化
 * JSON 最自然），到了 argv 才序列化成 `--definition '<json>'`。
 * @module @dsh-plus/actual-reports/capability
 */

import { FAMILIES, type FamilySpec, type OptionSpec } from './actions.ts'

/** 执行计划里的一个选项（argv 映射数据）。 */
export interface ReportsArgPlan {
  prop: string
  flag: string
  type: OptionSpec['type']
  required: boolean
}

/** 执行计划里的一个动作。 */
export interface ReportsActionPlan {
  action: string
  summary: string
  readOnly: boolean
  args: ReportsArgPlan[]
}

/** 一个族的执行计划（argv 前缀由上层在运行时填）。 */
export interface ReportsPlan {
  kind: 'reports'
  family: string
  actions: ReportsActionPlan[]
}

/** 一条可直接入目录的能力（形状与 `CapabilityEntry` 对齐）。 */
export interface ReportsCapability {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  source: 'cli'
  readOnly: boolean
  reports: ReportsPlan
}

/** 族内动作名清单。 */
export function ACTION_NAMES(family: FamilySpec): string[] {
  return family.actions.map((item) => item.action)
}

/** 选项 → JSON Schema 片段。 */
function propertySchema(spec: OptionSpec): Record<string, unknown> {
  const schema: Record<string, unknown> =
    spec.type === 'boolean'
      ? { type: 'boolean' }
      : spec.type === 'json'
        ? { type: 'object' }
        : { type: 'string' }
  return { ...schema, description: spec.description }
}

/** 逐动作并集 schema：action 显式枚举，参数按属性名合并（同名同义）。 */
function inputSchemaOf(family: FamilySpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    action: {
      type: 'string',
      enum: ACTION_NAMES(family),
      description: family.actions.map((item) => `${item.action}：${item.summary}`).join(' '),
    },
  }
  for (const action of family.actions) {
    for (const spec of action.args) {
      properties[spec.prop] = propertySchema(spec)
    }
  }
  return { type: 'object', properties, required: ['action'], additionalProperties: false }
}

/** 动作 → 执行计划。 */
function planOf(family: FamilySpec): ReportsPlan {
  return {
    kind: 'reports',
    family: family.family,
    actions: family.actions.map((action) => ({
      action: action.action,
      summary: action.summary,
      readOnly: action.readOnly,
      args: action.args.map((spec) => ({
        prop: spec.prop,
        flag: spec.flag,
        type: spec.type,
        required: spec.required === true,
      })),
    })),
  }
}

/** 工具级描述（面向模型：先做什么、能拿到什么、单位是什么）。 */
/** 工具描述 = 族摘要 + 族级使用建议（两者都来自唯一的动作表）。 */
function descriptionOf(family: FamilySpec): string {
  return `${family.summary}\n${family.guidance}`
}

/** 编译一个族的能力描述符。 */
export function familyCapability(family: FamilySpec): ReportsCapability {
  return {
    name: family.family,
    description: descriptionOf(family),
    inputSchema: inputSchemaOf(family),
    source: 'cli',
    readOnly: family.actions.every((action) => action.readOnly),
    reports: planOf(family),
  }
}

/** 本包对外提供的全部能力。 */
export const FAMILY_CAPABILITIES: readonly ReportsCapability[] = FAMILIES.map(familyCapability)

/** 按工具名取能力。 */
export function findCapability(name: string): ReportsCapability | undefined {
  return FAMILY_CAPABILITIES.find((item) => item.name === name)
}
