/**
 * pi-ai 内置目录适配：extends 继承解析的唯一数据源，也是配置页「内置模型目录」
 * 浏览器的数据来源。
 *
 * 两个「不钉死」：
 * - 目录条目随已装 dsh 的 pi-ai 版本自动更新（本文件只读，不复制目录）；
 * - 可继承的模型级键集按已装官方适配器 Config schema 现场推导
 *   （`kit.officialModelFields`），官方新增模型级字段即自动透传；
 *   目录里出现而官方 schema 不接受的字段（如 cost/headers/inputLimits）
 *   仍会被摘进 facts.rest 供界面展示，但不参与继承。
 *
 * 运行时读取对未知/异形字段宽容（跨版本容忍）：只把能确认形状的值纳入事实。
 * @module llm-pi/catalog/builtin
 */
import type { DshKit } from '../resolve-dsh.ts'

/** 内置目录的 provider id 字面量联合（pi-ai 生成目录的键集，按 vendored 版本收窄）。 */
export type BuiltinProviderId = ReturnType<DshKit['getBuiltinProviders']>[number]

/** 浏览/状态用的 provider 条目（不含 pi-ai 的函数面，可安全序列化给浏览器半）。 */
export interface BuiltinProviderEntry {
  id: string
  name: string
  baseUrl?: string
  modelCount: number
}

/**
 * 单个内置模型的事实快照（与 pi-ai 类型解耦的运行期读取结果）。
 * `rest` 是目录给出但本插件不认识的其余自有键（展示用，随上游字段增删自动变化）。
 */
export interface BuiltinModelFacts {
  provider: string
  id: string
  /** `provider/id` 路径 id（extends 引用与「复制路径 id」用）。 */
  path: string
  name: string
  api: string
  baseUrl: string
  reasoning: boolean
  input: ('text' | 'image')[]
  contextWindow: number
  maxTokens: number
  thinkingLevelMap?: Record<string, string | null>
  compat?: Record<string, unknown>
  rest: Record<string, unknown>
}

/** 继承源可提供的模型字段（pi-ai Model 的可继承子集）。 */
export interface ModelBase {
  name?: string
  api?: string
  baseUrl?: string
  input?: ('text' | 'image')[]
  reasoning?: boolean
  thinkingLevelMap?: Record<string, string | null | undefined>
  compat?: Record<string, unknown>
  contextWindow?: number
  maxTokens?: number
  /** 官方 schema 接受、且目录给出的其余模型级字段（键集现场推导，浅拷贝）。 */
  extra?: Record<string, unknown>
}

/** 已在 facts 显式取出的键：这些不再进 rest。 */
const FACT_KEYS = new Set([
  'id',
  'provider',
  'name',
  'api',
  'baseUrl',
  'reasoning',
  'input',
  'contextWindow',
  'maxTokens',
  'thinkingLevelMap',
  'compat',
])

/** JSON 值浅拷贝（对象/数组一层；条目要经 settings 序列化，不可留上游引用）。 */
export function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...value]
  if (typeof value === 'object' && value !== null) return { ...(value as Record<string, unknown>) }
  return value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 读模态数组：只保留 text/image 两种已知值，其余丢弃（防上游改成别的枚举）。 */
function readInput(value: unknown): ('text' | 'image')[] {
  if (!Array.isArray(value)) return ['text']
  const out = value.filter((m): m is 'text' | 'image' => m === 'text' || m === 'image')
  return out.length > 0 ? out : ['text']
}

/** 读 thinkingLevelMap：值为字符串或 null，其余（含 undefined 键）丢弃。 */
function readThinkingLevelMap(value: unknown): Record<string, string | null> | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const out: Record<string, string | null> = {}
  for (const [level, wire] of Object.entries(record)) {
    if (typeof wire === 'string') out[level] = wire
    else if (wire === null) out[level] = null
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 把运行期模型对象读成事实快照。入参用 unknown：pi-ai Model 的类型随版本变化，
 * 继承/浏览都只依赖此处确认过的字段，未确认的一律进 rest 原样展示。
 */
export function builtinModelFacts(provider: string, raw: unknown): BuiltinModelFacts | undefined {
  const model = asRecord(raw)
  if (model === undefined) return undefined
  const id = model['id']
  if (typeof id !== 'string' || id.length === 0) return undefined
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(model)) {
    if (FACT_KEYS.has(key) || value === undefined) continue
    rest[key] = cloneJsonValue(value)
  }
  const name = model['name']
  const api = model['api']
  const baseUrl = model['baseUrl']
  const contextWindow = model['contextWindow']
  const maxTokens = model['maxTokens']
  const thinkingLevelMap = readThinkingLevelMap(model['thinkingLevelMap'])
  const compat = asRecord(model['compat'])
  return {
    provider,
    id,
    path: `${provider}/${id}`,
    name: typeof name === 'string' && name.length > 0 ? name : id,
    api: typeof api === 'string' ? api : '',
    baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
    reasoning: model['reasoning'] === true,
    input: readInput(model['input']),
    contextWindow: typeof contextWindow === 'number' ? contextWindow : 0,
    maxTokens: typeof maxTokens === 'number' ? maxTokens : 0,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    ...(compat === undefined ? {} : { compat: { ...compat } }),
    rest,
  }
}

/** 内置 provider 的端点（provider 级 extends 的 baseURL 缺省值）。 */
export function builtinProviderBaseUrl(kit: DshKit, provider: string): string | undefined {
  return kit.builtinProviders().find((p) => p.id === provider)?.baseUrl
}

/**
 * 内置目录是否存在该 provider；同时把运行期配置里的 provider 字符串
 * 收窄为目录键字面量（调用方随后可直调 getBuiltinModels）。
 */
export function hasBuiltinProvider(kit: DshKit, provider: string): provider is BuiltinProviderId {
  const ids: readonly string[] = kit.getBuiltinProviders()
  return ids.includes(provider)
}

/** 内置 provider 的全部模型 id（UI 选择器/浏览用）。 */
export function builtinModelIds(kit: DshKit, provider: string): string[] {
  if (!hasBuiltinProvider(kit, provider)) return []
  return kit.getBuiltinModels(provider).map((m) => m.id)
}

/** 内置目录的全部 provider 条目（含 pi-ai 给的显示名与端点）。 */
export function builtinProviderEntries(kit: DshKit): BuiltinProviderEntry[] {
  const catalog = kit.builtinProviders()
  const byId = new Map(catalog.map((p) => [p.id as string, p]))
  return kit.getBuiltinProviders().map((id) => {
    const provider = byId.get(id)
    const baseUrl = provider?.baseUrl
    return {
      id,
      name: provider?.name ?? id,
      ...(typeof baseUrl === 'string' && baseUrl.length > 0 ? { baseUrl } : {}),
      modelCount: kit.getBuiltinModels(id).length,
    }
  })
}

/** 取某 provider 下某模型的事实快照；provider/模型不存在返回 undefined。 */
export function builtinModelFactsOf(
  kit: DshKit,
  provider: string,
  modelId: string,
): BuiltinModelFacts | undefined {
  if (!hasBuiltinProvider(kit, provider)) return undefined
  const model = kit.getBuiltinModels(provider).find((m) => m.id === modelId)
  return model === undefined ? undefined : builtinModelFacts(provider, model)
}

/** 事实快照 → 继承 base（`extra` 只包含官方 schema 接受的其余模型级键）。 */
export function modelBaseOf(kit: DshKit, facts: BuiltinModelFacts): ModelBase {
  const extra: Record<string, unknown> = {}
  for (const field of kit.officialModelFields) {
    if (FACT_KEYS.has(field) || field === 'reasoningEfforts') continue
    const value = facts.rest[field]
    if (value !== undefined) extra[field] = cloneJsonValue(value)
  }
  return {
    name: facts.name,
    api: facts.api,
    baseUrl: facts.baseUrl,
    input: [...facts.input],
    reasoning: facts.reasoning,
    ...(facts.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: { ...facts.thinkingLevelMap } }),
    ...(facts.compat === undefined ? {} : { compat: { ...facts.compat } }),
    contextWindow: facts.contextWindow,
    maxTokens: facts.maxTokens,
    ...(Object.keys(extra).length === 0 ? {} : { extra }),
  }
}

/** 查单个内置模型为继承 base；未命中返回 undefined。 */
export function builtinModelBase(
  kit: DshKit,
  provider: string,
  modelId: string,
): ModelBase | undefined {
  const facts = builtinModelFactsOf(kit, provider, modelId)
  return facts === undefined ? undefined : modelBaseOf(kit, facts)
}

/**
 * provider 级 extends 的全量模型继承：route 不写 models 时，
 * 以继承源 provider 的全部内置模型作为条目（每个条目 base 即其自身）。
 */
export function inheritedCatalogEntries(
  kit: DshKit,
  provider: string,
): { id: string; base: ModelBase }[] {
  if (!hasBuiltinProvider(kit, provider)) return []
  return kit.getBuiltinModels(provider).map((model) => {
    const facts = builtinModelFacts(provider, model)
    return { id: model.id, base: facts === undefined ? {} : modelBaseOf(kit, facts) }
  })
}
