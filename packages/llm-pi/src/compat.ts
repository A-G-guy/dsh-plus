/**
 * 逐协议 compat 字段表与校验。
 *
 * 背景：官方 llm-pi-ai 的配置路径只物化 thinkingFormat/supportsReasoningEffort
 * 两个字段，多余键被静默丢弃；本插件开放 pi-ai 的全量 compat（字段表与
 * pi-ai@0.82.1 types.d.ts:423-538 逐字段对齐），并在 settings 写入与
 * profile 构建时校验——未知键/错类型值直接拒绝并给出合法键清单。
 *
 * pi-ai 侧消费语义：getCompat 逐字段 `??` 覆盖 detectCompat 的
 * baseURL/名称猜测；undefined 视为未设置（无法显式清空检测值）。
 * @module llm-pi/compat
 */
import type { ProtocolId } from './config.ts'

type CompatValue = 'boolean' | 'object' | readonly string[]

/** openai-completions 的 21 个字段（pi-ai OpenAICompletionsCompat）。 */
const COMPLETIONS_FIELDS: Record<string, CompatValue> = {
  supportsStore: 'boolean',
  supportsDeveloperRole: 'boolean',
  supportsReasoningEffort: 'boolean',
  supportsUsageInStreaming: 'boolean',
  maxTokensField: ['max_completion_tokens', 'max_tokens'],
  requiresToolResultName: 'boolean',
  requiresAssistantAfterToolResult: 'boolean',
  requiresThinkingAsText: 'boolean',
  requiresReasoningContentOnAssistantMessages: 'boolean',
  thinkingFormat: [
    'openai',
    'openrouter',
    'deepseek',
    'together',
    'zai',
    'qwen',
    'chat-template',
    'qwen-chat-template',
    'string-thinking',
    'ant-ling',
  ],
  chatTemplateKwargs: 'object',
  openRouterRouting: 'object',
  vercelGatewayRouting: 'object',
  zaiToolStream: 'boolean',
  supportsOpenAIGrammarTools: 'boolean',
  supportsStrictMode: 'boolean',
  cacheControlFormat: ['anthropic'],
  sendSessionAffinityHeaders: 'boolean',
  deferredToolsMode: ['kimi'],
  sessionAffinityFormat: ['openai', 'openai-nosession', 'openrouter'],
  supportsLongCacheRetention: 'boolean',
}

/** openai-responses 的 7 个字段（pi-ai OpenAIResponsesCompat）。 */
const RESPONSES_FIELDS: Record<string, CompatValue> = {
  supportsDeveloperRole: 'boolean',
  sessionAffinityFormat: ['openai', 'openai-nosession', 'openrouter'],
  supportsLongCacheRetention: 'boolean',
  supportsStrictMode: 'boolean',
  supportsOpenAIGrammarTools: 'boolean',
  supportsToolSearch: 'boolean',
  supportsExplicitPromptCacheMode: 'boolean',
}

/** anthropic-messages 的 9 个字段（pi-ai AnthropicMessagesCompat）。 */
const ANTHROPIC_FIELDS: Record<string, CompatValue> = {
  supportsEagerToolInputStreaming: 'boolean',
  supportsLongCacheRetention: 'boolean',
  sendSessionAffinityHeaders: 'boolean',
  supportsCacheControlOnTools: 'boolean',
  supportsTemperature: 'boolean',
  forceAdaptiveThinking: 'boolean',
  allowEmptySignature: 'boolean',
  supportsStrictTools: 'boolean',
  supportsToolReferences: 'boolean',
}

const FIELDS_BY_PROTOCOL: Record<ProtocolId, Record<string, CompatValue>> = {
  'openai-completions': COMPLETIONS_FIELDS,
  'openai-responses': RESPONSES_FIELDS,
  'anthropic-messages': ANTHROPIC_FIELDS,
}

/** 某协议的全部合法 compat 键（UI 渲染字段组与校验共用）。 */
export function compatFieldsOf(api: ProtocolId): readonly string[] {
  return Object.keys(FIELDS_BY_PROTOCOL[api])
}

/** 某协议某字段的取值约束（UI 渲染开关/下拉用）。 */
export function compatFieldSpec(api: ProtocolId, field: string): CompatValue | undefined {
  return FIELDS_BY_PROTOCOL[api][field]
}

function checkValue(api: ProtocolId, field: string, spec: CompatValue, value: unknown, where: string): void {
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
    throw new Error(`${where}: compat.${field} 必须是 ${spec.map((v) => JSON.stringify(v)).join(' | ')} 之一`)
  }
}

/**
 * 校验一份 compat 字典对指定协议合法：未知协议/未知键拒绝（对比官方的静默丢弃），
 * 已知键校验值类型/枚举。undefined 值视为未设置，跳过（语义同 pi-ai 的 ??）。
 */
export function validateCompat(api: string, compat: Record<string, unknown> | undefined, where: string): void {
  if (compat === undefined) return
  const fields = FIELDS_BY_PROTOCOL[api as ProtocolId]
  if (fields === undefined) {
    throw new Error(`${where}: 协议 ${JSON.stringify(api)} 无 compat 字段表（支持：${Object.keys(FIELDS_BY_PROTOCOL).join(', ')}）`)
  }
  for (const [key, value] of Object.entries(compat)) {
    const spec = fields[key]
    if (spec === undefined) {
      throw new Error(
        `${where}: compat.${key} 不是 ${api} 协议的合法字段（合法字段：${Object.keys(fields).join(', ')}）`,
      )
    }
    if (value === undefined) continue
    checkValue(api, key, spec, value, where)
  }
}

/**
 * 逐字段合并 compat 层（后者覆盖前者），丢弃 undefined 值。
 * 层序：继承源（仅同协议）→ route 级 → 模型级。
 */
export function mergeCompat(
  ...layers: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {}
  for (const layer of layers) {
    if (layer === undefined) continue
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) merged[key] = value
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}
