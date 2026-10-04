/**
 * 官方适配面的**自动继承**：从已安装的官方副本（`dsh-llm-pi-ai` + `pi-ai`）
 * 现场推导三样东西，取代早期的手抄镜像：
 *
 * 1. **线协议集合**：官方包根导出的 `supportedProtocols()`（官方 PROTOCOLS 表
 *    的唯一投影）。官方新增协议时本插件自动可用，不再需要改代码；
 * 2. **compat 门控与取值约束**：门控取自运行期 bundle 的 `COMPAT_GATES`
 *    （事实源：运行期拒绝哪些字段由它决定），取值约束取自导出的 Config schema
 *    的 `providers.*.compat` 节点（boolean / number.step(1) / enum / 对象）；
 * 3. **模型条目字段集**：Config schema 的 `providers.*.models` 键集——继承时按此
 *    透传 pi-ai 目录的同名字段，官方将来新增模型级字段即自动跟随。
 *
 * 历史教训（0.1.5-rc.1）：compat 门控曾是官方 catalog.ts 的手抄镜像，官方扩容
 * offer 字段而旧表漏收，导致官方可配字段被本插件**误拒**（静默功能缺失、无报错）。
 * 现改为现场推导，`tests/official-surface.test.ts` 直读官方副本守门推导正确性。
 *
 * 推导失败（官方改布局/改打包形态）时回退到 FALLBACK_*：compat 表用最后已知快照
 * 且**放宽未知键**（见 compat.ts：宁可放行交给官方自身校验，也不误拒官方新字段），
 * 协议回退三元组、模型字段回退已知七键，各自给出诊断——绝不因推导失败弄挂启动。
 * @module llm-pi/official-surface
 */
import { FALLBACK_PROTOCOLS } from './config.ts'

/** 字段可配性：offer = 官方允许写；withhold = 官方为厂商内置、写时拒绝。 */
export type CompatDisposition = 'offer' | 'withhold'

/** 取值约束（从官方 schema 节点推导；'integer' = number 且 step=1）。 */
export type CompatValue = 'boolean' | 'integer' | 'number' | 'object' | readonly string[]

/** 推导结果：协议 → (字段 → 分型) + 字段 → 取值约束。 */
export interface CompatTable {
  readonly gates: Readonly<Record<string, Readonly<Record<string, CompatDisposition>>>>
  readonly specs: Readonly<Record<string, CompatValue>>
  /** 数据来源（诊断/状态行）：official = 现场推导成功。 */
  readonly source: 'official' | 'fallback'
  /** source=fallback 时的原因（供日志）。 */
  readonly problem?: string
}

/** 官方 Config schema 的最小结构面（schemastery 节点；只读我们消费的部分）。 */
export interface SchemaNode {
  type?: string
  dict?: Record<string, SchemaNode>
  list?: readonly SchemaNode[]
  inner?: SchemaNode
  meta?: { step?: number }
  value?: unknown
}

/** 官方插件模块表面（推导所需的两个输入）。 */
export interface OfficialAdapterSurface {
  /** `lib/index.js` 的绝对路径（读文本解析 COMPAT_GATES）。 */
  bundlePath: string
  /** 导入的模块命名空间（取 Config 导出）。 */
  module: Record<string, unknown>
}

/** 从 `{` 起做括号配对，返回内部文本；未配对返回 undefined。 */
function balancedBody(text: string, openIndex: number): string | undefined {
  const start = text.indexOf('{', openIndex)
  if (start < 0) return undefined
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return undefined
}

/** 解析 `field: "offer" | "withhold"` 键值对。 */
function parseGateFields(body: string): Record<string, CompatDisposition> {
  const out: Record<string, CompatDisposition> = {}
  for (const m of body.matchAll(/(\w+):\s*"(offer|withhold)"/g)) {
    out[m[1] as string] = m[2] as CompatDisposition
  }
  return out
}

/** 取 `const NAME = { ... }` 的块体（兼容 `let`/`var` 与省略分号）。 */
function namedBlock(bundle: string, name: string): string | undefined {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`)
  const m = re.exec(bundle)
  return m === null ? undefined : balancedBody(bundle, m.index + m[0].length)
}

/** 解析顶层 `"api": IDENT` 与 `"api": { ... }` 两种条目。 */
function splitGateEntries(body: string): Map<string, string | Record<string, CompatDisposition>> {
  const out = new Map<string, string | Record<string, CompatDisposition>>()
  const re = /"([^"]+)"\s*:\s*/g
  let m: RegExpExecArray | null = re.exec(body)
  while (m !== null) {
    const api = m[1] as string
    const rest = body.slice(m.index + m[0].length)
    if (rest.startsWith('{')) {
      const inner = balancedBody(rest, 0)
      if (inner !== undefined) out.set(api, parseGateFields(inner))
    } else {
      const ident = /^[A-Za-z_$][\w$]*/.exec(rest)
      if (ident !== null) out.set(api, ident[0])
    }
    m = re.exec(body)
  }
  return out
}

/**
 * 从运行期 bundle 推导「协议 → 门控」：解析 COMPAT_GATES 的每条目，
 * 命名常量回查同名 `const` 块，内联对象直接取字段。
 */
export function deriveGates(
  bundle: string,
): Record<string, Record<string, CompatDisposition>> | undefined {
  const gatesBody = namedBlock(bundle, 'COMPAT_GATES')
  if (gatesBody === undefined) return undefined
  const out: Record<string, Record<string, CompatDisposition>> = {}
  for (const [api, ref] of splitGateEntries(gatesBody)) {
    if (typeof ref !== 'string') {
      out[api] = ref
      continue
    }
    const block = namedBlock(bundle, ref)
    if (block === undefined) continue
    const fields = parseGateFields(block)
    if (Object.keys(fields).length > 0) out[api] = fields
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 单个 schema 节点 → 取值约束；无法归类的返回 undefined（跳过该字段）。 */
function specOfNode(node: SchemaNode | undefined): CompatValue | undefined {
  if (node === undefined) return undefined
  if (node.type === 'boolean') return 'boolean'
  if (node.type === 'number') return node.meta?.step === 1 ? 'integer' : 'number'
  if (node.type === 'dict') return 'object'
  if (node.type === 'object') return 'object'
  if (node.type === 'union' && Array.isArray(node.list) && node.list.length > 0) {
    const values: string[] = []
    for (const member of node.list) {
      if (member?.type === 'const' && typeof member.value === 'string') values.push(member.value)
      else return undefined // 含非字符串成员的联合（如模板 $var 对象）不入枚举
    }
    return values
  }
  return undefined
}

/** 从官方 Config schema 推导字段取值约束（`providers.*.compat` 节点）。 */
export function deriveSpecs(module: Record<string, unknown>): Record<string, CompatValue> {
  const config = module['Config'] as SchemaNode | undefined
  const compat = config?.dict?.['providers']?.inner?.dict?.['compat']
  const fields = compat?.dict
  if (fields === undefined) return {}
  const out: Record<string, CompatValue> = {}
  for (const [field, node] of Object.entries(fields)) {
    const spec = specOfNode(node)
    if (spec !== undefined) out[field] = spec
  }
  return out
}

/**
 * 从官方适配器模块推导线协议集合：官方包根导出的 `supportedProtocols()`
 * （`Object.keys(PROTOCOLS)` 的投影，顺序即官方表顺序）。
 * 非函数/返回空/含非字符串项都视为推导失败，调用方回退内置三元组。
 */
export function deriveProtocols(module: Record<string, unknown>): string[] | undefined {
  const reader = module['supportedProtocols']
  if (typeof reader !== 'function') return undefined
  const value = (reader as () => unknown)()
  if (!Array.isArray(value) || value.length === 0) return undefined
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return ids.length === value.length ? ids : undefined
}

/**
 * 从官方 Config schema 推导模型条目字段集（`providers.*.models` 的元素键集）。
 * 这些是官方适配器**接受**的模型级键；继承时按此透传 pi-ai 目录的同名字段。
 */
export function deriveModelEntryFields(module: Record<string, unknown>): string[] | undefined {
  const config = module['Config'] as SchemaNode | undefined
  const models = config?.dict?.['providers']?.inner?.dict?.['models']
  const fields = models?.inner?.dict
  if (fields === undefined) return undefined
  const keys = Object.keys(fields)
  return keys.length > 0 ? keys : undefined
}

/** 推导失败时的模型条目字段兜底（0.2.x 线实测键集）。 */
export const FALLBACK_MODEL_ENTRY_FIELDS = [
  'id',
  'name',
  'contextWindow',
  'maxTokens',
  'input',
  'reasoningEfforts',
  'compat',
] as const

/** 协议推导失败时的兜底三元组（转出为可变数组，便于调用方直接持有）。 */
export function fallbackProtocols(): string[] {
  return [...FALLBACK_PROTOCOLS]
}

/** 官方门控表不可解析时的最后已知快照（0.1.5-rc.2 实测值）。 */
export const FALLBACK_TABLE: CompatTable = {
  source: 'fallback',
  gates: {
    'openai-completions': {
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
      thinkingTokenBudgetField: 'offer',
      vllmPriority: 'offer',
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
    },
    'openai-responses': {
      supportsDeveloperRole: 'offer',
      supportsMaxOutputTokens: 'offer',
      supportsStrictMode: 'offer',
      supportsLongCacheRetention: 'offer',
      sessionAffinityFormat: 'withhold',
      supportsOpenAIGrammarTools: 'withhold',
      supportsAdditionalTools: 'withhold',
      supportsToolSearch: 'withhold',
      supportsExplicitPromptCacheMode: 'withhold',
    },
    'anthropic-messages': {
      supportsEagerToolInputStreaming: 'offer',
      supportsLongCacheRetention: 'offer',
      supportsCacheControlOnTools: 'offer',
      supportsTemperature: 'offer',
      forceAdaptiveThinking: 'offer',
      allowEmptySignature: 'offer',
      supportsStrictTools: 'offer',
      sendSessionAffinityHeaders: 'withhold',
      supportsToolReferences: 'withhold',
      supportsMidConvoEffort: 'withhold',
      allowedFallbackModels: 'withhold',
    },
  },
  specs: {
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
    thinkingTokenBudgetField: [
      'thinking_token_budget',
      'thinking_budget',
      'thinking_budget_tokens',
    ],
    vllmPriority: 'integer',
    supportsMaxOutputTokens: 'boolean',
    supportsStrictMode: 'boolean',
    cacheControlFormat: ['anthropic'],
    supportsLongCacheRetention: 'boolean',
    supportsEagerToolInputStreaming: 'boolean',
    supportsCacheControlOnTools: 'boolean',
    supportsTemperature: 'boolean',
    forceAdaptiveThinking: 'boolean',
    allowEmptySignature: 'boolean',
    supportsStrictTools: 'boolean',
  },
}
