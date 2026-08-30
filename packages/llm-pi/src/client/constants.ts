/**
 * 浏览器半内联常量：与服务端 packages/llm-pi/src/config.ts、compat.ts 逐字对齐。
 * 浏览器半不能 import 服务端模块（tsdown 只打包 client 侧入口），
 * 改动服务端这些常量时必须同步本文件。
 * @module llm-pi/client/constants
 */

/** 协议枚举（来源：config.ts PROTOCOL_IDS）。 */
export const PROTOCOL_IDS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

/** thinking 档位（来源：config.ts THINKING_LEVELS）。 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** 请求模态（来源：config.ts MODALITIES）。 */
export const MODALITIES = ['text', 'image'] as const

/** cacheRetention 枚举（来源：config.ts providerProfile.cacheRetention）。 */
export const CACHE_RETENTION_OPTIONS = ['none', 'short', 'long'] as const

/** transport 枚举（来源：config.ts providerProfile.transport）。 */
export const TRANSPORT_OPTIONS = ['sse', 'websocket', 'websocket-cached', 'auto'] as const

/** thinkingBudgets 档位键（来源：config.ts thinkingBudgets）。 */
export const BUDGET_KEYS = ['minimal', 'low', 'medium', 'high'] as const

type CompatValue = 'boolean' | 'object' | readonly string[]

/**
 * 逐协议 compat 字段表（来源：compat.ts，逐字段镜像官方 catalog.ts COMPAT_GATES）。
 * 只列 offer 字段（withhold 字段官方写时拒绝，UI 不提供）；取值约束对齐官方
 * config.ts compatProfile schema。
 */
const COMPAT_FIELDS: Record<string, Record<string, CompatValue>> = {
  'openai-completions': {
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
  },
  'openai-responses': {
    supportsDeveloperRole: 'boolean',
    supportsStrictMode: 'boolean',
    supportsLongCacheRetention: 'boolean',
  },
  'anthropic-messages': {
    supportsEagerToolInputStreaming: 'boolean',
    supportsLongCacheRetention: 'boolean',
    supportsCacheControlOnTools: 'boolean',
    supportsTemperature: 'boolean',
    forceAdaptiveThinking: 'boolean',
    allowEmptySignature: 'boolean',
    supportsStrictTools: 'boolean',
  },
}

/** 某协议的全部合法 compat 键（与服务端 compatFieldsOf 一致）。 */
export function compatFieldsOf(api: string): readonly string[] {
  return Object.keys(COMPAT_FIELDS[api] ?? {})
}

/** 某协议某字段的取值约束（与服务端 compatFieldSpec 一致）。 */
export function compatFieldSpec(api: string, field: string): CompatValue | undefined {
  return COMPAT_FIELDS[api]?.[field]
}

/** api 未设置时的渲染回退组（最常见的协议；保存仍由后端按实际协议校验）。 */
export const COMPAT_FALLBACK_API = 'openai-completions'
