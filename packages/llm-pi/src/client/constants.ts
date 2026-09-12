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

export type CompatValue = 'boolean' | 'integer' | 'number' | 'object' | readonly string[]

/**
 * 逐协议 compat 字段表：**服务端推导结果经 /catalog 下发**，浏览器半不再手抄
 * （手抄遗漏官方新增字段 = UI 不渲染 + 保存被后端拒绝；见 compat-gates.ts）。
 * 未拿到服务端表时用 EMPTY（UI 只渲染提示行），不放内置副本兜底——宁可少画
 * 控件，也不给出可能与官方不符的字段集。
 */
let compatTable: Record<string, Record<string, CompatValue>> = {}

/** 安装服务端下发的字段表（card 挂载/刷新目录时调用）。 */
export function installCompatFields(table: Record<string, Record<string, CompatValue>>): void {
  compatTable = table
}

/** 某协议的全部合法 compat 键（与服务端 compatFieldsOf 一致）。 */
export function compatFieldsOf(api: string): readonly string[] {
  return Object.keys(compatTable[api] ?? {})
}

/** 某协议某字段的取值约束（与服务端 compatFieldSpec 一致）。 */
export function compatFieldSpec(api: string, field: string): CompatValue | undefined {
  return compatTable[api]?.[field]
}

/** api 未设置时的渲染回退组（最常见的协议；保存仍由后端按实际协议校验）。 */
export const COMPAT_FALLBACK_API = 'openai-completions'
