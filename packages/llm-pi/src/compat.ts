/**
 * 逐协议 compat 门控表与校验（0.1.2-alpha.1 适配版）。
 *
 * 适配决策：官方 dsh-llm-pi-ai 0.1.2-alpha.1 的 COMPAT_GATES（catalog.ts:292）
 * 是 compat 可配性的唯一事实源——按协议分型（offer/withhold），withhold 字段
 * （catalog 已为对应厂商设置，如 openRouterRouting/zaiToolStream/
 * sendSessionAffinityHeaders/supportsToolSearch 等）写时拒绝并提示以目录
 * provider 名为 route。官方门控表只在 src/catalog.ts 源码子路径内（npm 发布
 * 形态不携带 src/、包根也不导出该符号），插件在 dsh 树（npm 布局）与 vendored
 * 兜底两条路径都无法静态引用，故本文件按官方 catalog.ts 逐字段镜像门控表
 * （字段全集与分型随 pi-ai 升级同步维护，官方以 Record<keyof Compat> 编译期
 * 约束漂移，插件以本表 + 注释人工同步）。
 *
 * 与旧版字段表的差异（0.1.2-alpha.1 官方门控）：
 * - completions 新增 offer：supportsFinishReason/chatTemplateArgs/
 *   supportsThinkingTokenBudget；thinkingFormat 新增 baseten；
 * - 原表内 openRouterRouting/vercelGatewayRouting/zaiToolStream/
 *   sendSessionAffinityHeaders/deferredToolsMode/sessionAffinityFormat/
 *   supportsOpenAIGrammarTools（completions/responses）与 supportsToolSearch/
 *   supportsExplicitPromptCacheMode（responses）、supportsToolReferences
 *   （anthropic）改为 withhold → 写时拒绝；
 * - responses 不再 offer sessionAffinityFormat（withhold）。
 *
 * pi-ai 侧消费语义：getCompat 逐字段 `??` 覆盖 detectCompat 的
 * baseURL/名称猜测；undefined 视为未设置（无法显式清空检测值）。
 * @module llm-pi/compat
 */
import type { ProtocolId } from './config.ts'

type CompatValue = 'boolean' | 'object' | readonly string[]
type CompatDisposition = 'offer' | 'withhold'

/**
 * 官方 COMPLETIONS_COMPAT_GATE（llm-pi-ai/src/catalog.ts）逐字段镜像。
 * offer 17 字段 / withhold 7 字段。
 */
const COMPLETIONS_COMPAT_GATE: Readonly<Record<string, CompatDisposition>> = {
  supportsStore: 'offer',
  supportsDeveloperRole: 'offer',
  supportsReasoningEffort: 'offer',
  supportsUsageInStreaming: 'offer',
  supportsFinishReason: 'offer',
  maxTokensField: 'offer',
  requiresToolResultName: 'offer',
  requiresAssistantAfterToolResult: 'offer',
  requiresThinkingAsText: 'offer',
  requiresReasoningContentOnAssistantMessages: 'offer',
  thinkingFormat: 'offer',
  chatTemplateKwargs: 'offer',
  chatTemplateArgs: 'offer',
  supportsThinkingTokenBudget: 'offer',
  supportsStrictMode: 'offer',
  cacheControlFormat: 'offer',
  supportsLongCacheRetention: 'offer',
  openRouterRouting: 'withhold',
  vercelGatewayRouting: 'withhold',
  zaiToolStream: 'withhold',
  supportsOpenAIGrammarTools: 'withhold',
  sendSessionAffinityHeaders: 'withhold',
  deferredToolsMode: 'withhold',
  sessionAffinityFormat: 'withhold',
}

/**
 * 官方 RESPONSES_COMPAT_GATE 逐字段镜像（三协议共享同一 OpenAIResponsesCompat；
 * 本插件只服务 openai-responses）。offer 3 字段 / withhold 5 字段。
 */
const RESPONSES_COMPAT_GATE: Readonly<Record<string, CompatDisposition>> = {
  supportsDeveloperRole: 'offer',
  supportsStrictMode: 'offer',
  supportsLongCacheRetention: 'offer',
  sessionAffinityFormat: 'withhold',
  supportsOpenAIGrammarTools: 'withhold',
  supportsAdditionalTools: 'withhold',
  supportsToolSearch: 'withhold',
  supportsExplicitPromptCacheMode: 'withhold',
}

/**
 * 官方 ANTHROPIC_COMPAT_GATE 逐字段镜像。offer 7 字段 / withhold 2 字段。
 */
const ANTHROPIC_COMPAT_GATE: Readonly<Record<string, CompatDisposition>> = {
  supportsEagerToolInputStreaming: 'offer',
  supportsLongCacheRetention: 'offer',
  supportsCacheControlOnTools: 'offer',
  supportsTemperature: 'offer',
  forceAdaptiveThinking: 'offer',
  allowEmptySignature: 'offer',
  supportsStrictTools: 'offer',
  sendSessionAffinityHeaders: 'withhold',
  supportsToolReferences: 'withhold',
}

const GATES_BY_PROTOCOL: Record<ProtocolId, Readonly<Record<string, CompatDisposition>>> = {
  'openai-completions': COMPLETIONS_COMPAT_GATE,
  'openai-responses': RESPONSES_COMPAT_GATE,
  'anthropic-messages': ANTHROPIC_COMPAT_GATE,
}

/** 某协议某字段的可配性（'offer'/'withhold'；未列出 = 无此字段）。 */
export function compatDispositionOf(api: ProtocolId, field: string): CompatDisposition | undefined {
  return GATES_BY_PROTOCOL[api][field]
}

/**
 * 字段取值约束（对齐官方 config.ts compatProfile schema）：
 * boolean 字段 → 'boolean'；maxTokensField/thinkingFormat/cacheControlFormat
 * → 枚举；chatTemplateKwargs/chatTemplateArgs → 对象。
 */
const VALUE_SPECS: Readonly<Record<string, CompatValue>> = {
  supportsStore: 'boolean',
  supportsDeveloperRole: 'boolean',
  supportsReasoningEffort: 'boolean',
  supportsUsageInStreaming: 'boolean',
  supportsFinishReason: 'boolean',
  maxTokensField: ['max_completion_tokens', 'max_tokens'],
  requiresToolResultName: 'boolean',
  requiresAssistantAfterToolResult: 'boolean',
  requiresThinkingAsText: 'boolean',
  requiresReasoningContentOnAssistantMessages: 'boolean',
  thinkingFormat: [
    // 官方 SUPPORTED_THINKING_FORMATS（含 baseten，随 chatTemplateArgs 使用）
    'openai',
    'deepseek',
    'openrouter',
    'together',
    'baseten',
    'zai',
    'qwen',
    'chat-template',
    'qwen-chat-template',
    'string-thinking',
    'ant-ling',
  ],
  chatTemplateKwargs: 'object',
  chatTemplateArgs: 'object',
  supportsThinkingTokenBudget: 'boolean',
  supportsStrictMode: 'boolean',
  cacheControlFormat: ['anthropic'],
  supportsLongCacheRetention: 'boolean',
  supportsEagerToolInputStreaming: 'boolean',
  supportsCacheControlOnTools: 'boolean',
  supportsTemperature: 'boolean',
  forceAdaptiveThinking: 'boolean',
  allowEmptySignature: 'boolean',
  supportsStrictTools: 'boolean',
}

/** 某协议全部可配置（offer）的 compat 键（UI 渲染字段组与校验共用）。 */
export function compatFieldsOf(api: ProtocolId): readonly string[] {
  return Object.entries(GATES_BY_PROTOCOL[api]).flatMap(([field, disposition]) =>
    disposition === 'offer' ? [field] : [],
  )
}

/** 某协议某 offer 字段的取值约束（UI 渲染开关/下拉用）。 */
export function compatFieldSpec(api: ProtocolId, field: string): CompatValue | undefined {
  return GATES_BY_PROTOCOL[api][field] === 'offer' ? VALUE_SPECS[field] : undefined
}

function checkValue(field: string, spec: CompatValue, value: unknown, where: string): void {
  if (spec === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${where}: compat.${field} 必须是布尔值`)
    return
  }
  if (spec === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${where}: compat.${field} 必须是对象`)
    }
    return
  }
  if (typeof value !== 'string' || !spec.includes(value)) {
    throw new Error(
      `${where}: compat.${field} 必须是 ${spec.map((v) => JSON.stringify(v)).join(' | ')} 之一`,
    )
  }
}

/**
 * 校验一份 compat 字典对指定协议合法（对齐官方门控语义 + schema 值约束）：
 * - 未知键/withhold 字段拒绝（官方 0.1.2-alpha.1 写时拒绝，替代旧版静默丢弃）；
 * - 值类型/枚举按官方 schema 校验；
 * - 无值键（null/undefined）拒绝（官方 assertOfferedCompatFields 同款：
 *   "写了但没生效" 的表面状态不允许）。
 */
export function validateCompat(
  api: string,
  compat: Record<string, unknown> | undefined,
  where: string,
): void {
  if (compat === undefined) return
  const gate = GATES_BY_PROTOCOL[api as ProtocolId]
  if (gate === undefined) {
    throw new Error(
      `${where}: 协议 ${JSON.stringify(api)} 无 compat 字段表（支持：${Object.keys(GATES_BY_PROTOCOL).join(', ')}）`,
    )
  }
  const offered = compatFieldsOf(api as ProtocolId)
  for (const [key, value] of Object.entries(compat)) {
    const disposition = gate[key]
    if (disposition !== 'offer') {
      if (disposition === 'withhold') {
        throw new Error(
          `${where}: compat.${key} 官方按协议 withhold（内置目录已为对应厂商设置该开关）；` +
            '请以目录 provider 名作为 route 名（继承目录值），或移除该字段',
        )
      }
      throw new Error(
        `${where}: compat.${key} 不是 ${api} 协议的合法字段（可配置字段：${offered.join(', ')}）`,
      )
    }
    if (value === undefined || value === null) {
      throw new Error(`${where}: compat.${key} 未设置值；给出值或移除该键（留空不会生效）`)
    }
    checkValue(key, VALUE_SPECS[key] as CompatValue, value, where)
  }
}

/**
 * 逐字段合并 compat 层（后者覆盖前者），丢弃 undefined/null 值。
 * 层序：继承源（仅同协议）→ route 级 → 模型级。
 */
export function mergeCompat(
  ...layers: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {}
  for (const layer of layers) {
    if (layer === undefined) continue
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined && value !== null) merged[key] = value
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}
