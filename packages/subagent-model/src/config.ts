/**
 * 配置单一事实源：cordis 行级 Config（组合默认值）与 settings namespace
 * （用户层，经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml）共用同一
 * schemastery schema。条目按【子代理 provider 名】键控（standard preset
 * 事实映射：subagent↔spawn、subagent_fork↔fork），特殊键 `default` 作为
 * 未命中具体 provider 时的兜底（spawn/fork 共享同一路由的便捷写法）。
 *
 * 运行时语义（详见 delegation.ts）：provider/model/reasoningEffort 显式时
 * 注入子代理 `request.agentOptions`——当前平台（0.1.2-rc.1）的
 * resolveChildAgentOptions 原生读取 provider/model/reasoningEffort 三个字段
 * （含冷恢复 descriptor），不再需要旧版 effort 瀑布的私有字段搬运。
 *
 * 与官方 subagent-model-selection 的关系：官方机制是"主代理模型可选白名单"，
 * 不强制任何模型（未显式选择时子代理继承主代理路由）；本插件补的是
 * "管理端强制默认路由"——主代理未显式选择时才注入，显式选择仍优先。
 * @module @dsh-plus/subagent-model/config
 */

import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间（字面量即合法命名空间；webui 配置卡片与插件运行期读取同一份）。 */
export const SETTINGS_NS = NS_LITERAL

/** 思考程度哨兵值：继承主代理（不注入 effort 字段）。 */
export const EFFORT_INHERIT = 'inherit'
/** 思考程度哨兵值：跟随模型默认（显式剥离任何继承/推导出的 effort）。 */
export const EFFORT_DEFAULT = 'default'
/** 兜底条目键：未命中具体 provider 名时生效（spawn/fork 共享同一路由的便捷写法）。 */
export const DEFAULT_ENTRY = 'default'

/** 一条条目的规范输出形态。 */
export interface EntryConfig {
  enabled: boolean
  provider: string
  model: string
  reasoningEffort: string
}

/** 配置的规范输出形态。 */
export interface SubagentModelConfig {
  enabled: boolean
  entries: Record<string, EntryConfig>
}

/** 配置的宽松输入形态（schema 校验前的用户数据）。 */
export interface SubagentModelConfigInput {
  enabled?: boolean | null
  entries?: Record<
    string,
    {
      enabled?: boolean | null
      provider?: string | null
      model?: string | null
      reasoningEffort?: string | null
    }
  > | null
}

const EntrySchema = z.object({
  enabled: z.boolean().description('该子代理 provider 行的开关').default(false),
  provider: z.string().description('LLM 提供商 id；留空 = 继承主代理').default(''),
  model: z.string().description('模型 id；留空 = 继承主代理').default(''),
  reasoningEffort: z
    .string()
    .description(
      `思考程度：${EFFORT_INHERIT}（继承主代理）/ ${EFFORT_DEFAULT}（跟随模型默认）/ 提供商目录档位 id`,
    )
    .default(EFFORT_INHERIT),
})

export const Config: z<SubagentModelConfigInput, SubagentModelConfig> = z.object({
  enabled: z.boolean().description('总开关').default(false),
  entries: z.dict(EntrySchema).description('按子代理 provider 名（spawn/fork/…）配置').default({}),
})

/** 注入子代理 AgentOptions 的结果对象：只含需要覆盖的字段。 */
export interface InjectedOptions {
  provider?: string
  model?: string
  reasoningEffort?: string
}

/**
 * 解析一条条目为要注入的 agentOptions 片段。
 * 未启用或全继承时返回 undefined（完全保持 dsh 原生行为）。
 */
export function resolveEntry(entry: EntryConfig): InjectedOptions | undefined {
  if (!entry.enabled) return undefined
  const out: InjectedOptions = {}
  if (entry.provider.length > 0) out.provider = entry.provider
  if (entry.model.length > 0) out.model = entry.model
  if (entry.reasoningEffort !== EFFORT_INHERIT) out.reasoningEffort = entry.reasoningEffort
  return out.provider !== undefined || out.model !== undefined || out.reasoningEffort !== undefined
    ? out
    : undefined
}

/** 按 provider 名解析条目，未命中时回落 default 兜底条目。 */
export function entryFor(
  current: () => SubagentModelConfig,
  name: string | undefined,
): InjectedOptions | undefined {
  if (name === undefined || !current().enabled) return undefined
  const entries = current().entries
  const direct = entries[name]
  if (direct !== undefined) return resolveEntry(direct)
  const fallback = entries[DEFAULT_ENTRY]
  return fallback === undefined ? undefined : resolveEntry(fallback)
}

/**
 * 合并注入片段与委托请求已有的 agentOptions：显式（工具行配置 / 主代理
 * 显式选择的路由）优先，插件只补空缺——与官方 agentOptions 合并语义一致。
 */
export function mergeAgentOptions(
  injected: InjectedOptions,
  existing: InjectedOptions | undefined,
): InjectedOptions {
  return { ...injected, ...existing }
}

/** 条目校验的输入面（settings 写入的 validate 钩子用）。 */
export interface EntryValidationInput {
  provider?: string | null
  model?: string | null
  reasoningEffort?: string | null
}

/** 校验一条用户提交的条目；返回错误消息，合法时返回 null。 */
export function validateEntry(entry: EntryValidationInput): string | null {
  const model = entry.model ?? ''
  const provider = entry.provider ?? ''
  const effort = entry.reasoningEffort ?? ''
  if (model.length > 0 && provider.length === 0) {
    return 'model 不能脱离 provider 单独配置（请先选择提供商或改回继承）'
  }
  if (effort.length === 0) {
    return 'reasoningEffort 不能为空（inherit / default / 档位 id）'
  }
  return null
}

/** 校验整组条目（settings 写入的 validate 钩子用）；返回首个错误消息，合法时返回 null。 */
export function validateEntries(entries: Record<string, EntryValidationInput>): string | null {
  for (const [name, entry] of Object.entries(entries)) {
    const error = validateEntry(entry)
    if (error !== null) return `条目 ${name}: ${error}`
  }
  return null
}
