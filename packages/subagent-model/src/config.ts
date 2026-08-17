/**
 * 配置单一事实源：cordis 行级 Config（组合默认值，dev/prod patch 层可覆盖）
 * 与 settings namespace（用户层，经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml）
 * 共用同一 schemastery schema。条目按【子代理 provider 名】键控
 * （standard preset 事实映射：subagent↔spawn、subagent_fork↔fork）。
 *
 * 运行时语义（详见 delegation.ts）：
 * - provider/model 显式时注入子代理 `agentOptions`（覆盖"继承主代理"快照）；
 * - reasoningEffort 显式时经私有字段随 agentOptions 抵达子代理，再由
 *   `agent/request` 瀑布监听器应用（dsh 原生 AgentOptions 不含 effort 字段）。
 *
 * 类型说明：z.dict 的推断类型引用 cosmokit 的 Dict，直接导出会触发
 * dts 的 TS2742（不可具名引用）；按官方 dsh-permission-presets 模式，
 * 显式声明输入/输出接口并注解 schema（输出为规范型，输入为可空宽松型）。
 * @module subagent-model/config
 */
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** settings 命名空间；webui 配置卡片与插件运行期读取同一份。 */
export const SETTINGS_NS = settingsNamespace('dsh-plus-subagent-model')

/** 思考程度哨兵值：继承主代理（不注入 effort 字段）。 */
export const EFFORT_INHERIT = 'inherit'
/** 思考程度哨兵值：跟随模型默认（显式剥离任何继承/推导出的 effort）。 */
export const EFFORT_DEFAULT = 'default'

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
  entries?: Record<string, {
    enabled?: boolean | null
    provider?: string | null
    model?: string | null
    reasoningEffort?: string | null
  }> | null
}

const EntrySchema = z.object({
  enabled: z.boolean().description('该子代理 provider 行的开关').default(false),
  provider: z.string().description('LLM 提供商 id；留空 = 继承主代理').default(''),
  model: z.string().description('模型 id；留空 = 继承主代理').default(''),
  reasoningEffort: z.string()
    .description(`思考程度：${EFFORT_INHERIT}（继承主代理）/ ${EFFORT_DEFAULT}（跟随模型默认）/ 提供商目录档位 id`)
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
  /** 私有标记：随 agentOptions 抵达子代理 options，由 agent/request 监听器消费。 */
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

/**
 * 合并注入片段与工具行已有的 agentOptions：部署级显式配置优先，
 * 插件只补空缺（standard preset 的工具行无 agentOptions，插件即生效）。
 */
export function mergeAgentOptions(
  injected: InjectedOptions,
  existing: InjectedOptions | undefined,
): InjectedOptions {
  return { ...injected, ...existing }
}

/** 请求配置的形状（与 dsh agent/request 瀑布产物的相关字段）。 */
export interface RequestConfig {
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens?: number
}

/**
 * 把条目的 effort 决策应用到一次 LLM 请求配置上（纯函数）：
 * - undefined：直通（未配置 effort，保持原生推导）；
 * - EFFORT_DEFAULT：剥离 reasoningEffort（跟随模型默认，覆盖 fork 的 seed 继承）；
 * - 其余：显式覆盖。
 */
export function applyEffort<T extends RequestConfig>(resolved: T, effort: string | undefined): T {
  if (effort === undefined) return resolved
  if (effort === EFFORT_DEFAULT) {
    const { reasoningEffort: _dropped, ...rest } = resolved
    return rest as T
  }
  return { ...resolved, reasoningEffort: effort } as T
}

/** 条目校验的输入面（卡片提交的可能为宽松形态）。 */
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

/** 配置卡片读取用的传输对象（writable 表示是否存在可写的 settings provider）。 */
export interface WireEntry {
  enabled: boolean
  provider: string
  model: string
  reasoningEffort: string
}

export interface WireConfig {
  enabled: boolean
  entries: Record<string, WireEntry>
  /** 当前已注册的子代理 provider 名（spawn/fork/…），供卡片合成空行。 */
  subagentProviders: string[]
  writable: boolean
}

export function toWire(cfg: SubagentModelConfig, subagentProviders: string[], writable: boolean): WireConfig {
  const entries: Record<string, WireEntry> = {}
  for (const [name, entry] of Object.entries(cfg.entries)) {
    entries[name] = {
      enabled: entry.enabled,
      provider: entry.provider,
      model: entry.model,
      reasoningEffort: entry.reasoningEffort,
    }
  }
  return { enabled: cfg.enabled, entries, subagentProviders: [...subagentProviders], writable }
}

/** 配置卡片写回用的宽松输入形态（字段全部可选，无默认值，深合并进用户层）。 */
export interface WirePatchInput {
  enabled?: boolean | null
  entries?: Record<string, {
    enabled?: boolean | null
    provider?: string | null
    model?: string | null
    reasoningEffort?: string | null
  }> | null
}

/** 配置卡片写回用的规范输出形态（校验后条目已填默认）。 */
export interface WirePatchOutput {
  enabled: boolean
  entries: Record<string, EntryConfig>
}

export const WirePatch: z<WirePatchInput, WirePatchOutput> = z.object({
  enabled: z.boolean(),
  entries: z.dict(EntrySchema),
})

/** 把卡片提交的 patch 规整为 settings.update 的用户层 patch（entries 整体替换）。 */
export function toUserPatch(input: WirePatchInput): Record<string, unknown> {
  return { ...input }
}
