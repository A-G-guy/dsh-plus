/**
 * 可编辑草稿模型与 ConfigValue ↔ Draft 双向转换。
 * 设计：数值字段用字符串承载（'' = 未设置/不写入），多选枚举用布尔 map，
 * 转换时剔除空值，保证 dirty 比较（toPatch 双侧）与保存形状稳定。
 * @module llm-pi/client/draft
 */
import type { ConfigPatch, ConfigValue, WireModel, WireProvider } from './api.ts'

export interface HeaderPair {
  key: string
  value: string
}

export interface InputDraft {
  text: boolean
  image: boolean
}

export interface BudgetDraft {
  minimal: string
  low: string
  medium: string
  high: string
}

/** reasoningEfforts：false = 非推理模型；levels 键为档位，'' = 未设置。 */
export interface ReasoningDraft {
  nonReasoning: boolean
  levels: Record<string, string>
}

export interface ModelDraft {
  id: string
  extends: string
  name: string
  contextWindow: string
  maxTokens: string
  input: InputDraft
  reasoningEfforts: ReasoningDraft
  compat: Record<string, unknown>
  /** 卡片未认识的字段原样往返（如 adapter: deepseek 的 imagePixelBudget 等）。 */
  extra: Record<string, unknown>
}

export interface ProviderDraft {
  extends: string
  displayName: string
  api: string
  baseURL: string
  apiKeyEnv: string
  headers: HeaderPair[]
  compat: Record<string, unknown>
  defaultContextWindow: string
  defaultMaxTokens: string
  input: InputDraft
  reasoning: string
  thinkingBudgets: BudgetDraft
  cacheRetention: string
  transport: string
  timeoutMs: string
  websocketConnectTimeoutMs: string
  streamIdleTimeoutMs: string
  maxRequestImageBytes: string
  retryPolicy: unknown
  models: ModelDraft[]
  /** 卡片未认识的字段原样往返（如 adapter/thinking/filesApiTimeoutMs 等）。 */
  extra: Record<string, unknown>
}

export interface Draft {
  enabled: boolean
  catalogUrl: string
  catalogRefreshHours: string
  catalogProxy: string
  providers: Record<string, ProviderDraft>
}

export function numToText(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

/** 数字文本 → 数值；空串/非法返回 undefined（不写入）。 */
export function toNum(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

export function numTextOk(text: string): boolean {
  return text.trim() !== '' && Number.isFinite(Number(text.trim()))
}

export function headersToPairs(headers: Record<string, string> | undefined): HeaderPair[] {
  return Object.entries(headers ?? {}).map(([key, value]) => ({ key, value }))
}

export function pairsToHeaders(pairs: HeaderPair[]): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const pair of pairs) {
    if (pair.key.trim() !== '') out[pair.key.trim()] = pair.value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function inputFromWire(list: string[] | undefined): InputDraft {
  return {
    text: list?.includes('text') ?? false,
    image: list?.includes('image') ?? false,
  }
}

function inputToWire(input: InputDraft): string[] | undefined {
  const out: string[] = []
  if (input.text) out.push('text')
  if (input.image) out.push('image')
  return out.length > 0 ? out : undefined
}

function reasoningFromWire(
  value: false | Record<string, string | null> | undefined,
): ReasoningDraft {
  if (value === false) return { nonReasoning: true, levels: {} }
  const levels: Record<string, string> = {}
  for (const [level, line] of Object.entries(value ?? {})) levels[level] = line ?? ''
  return { nonReasoning: false, levels }
}

function reasoningToWire(value: ReasoningDraft): false | Record<string, string> | undefined {
  if (value.nonReasoning) return false
  const out: Record<string, string> = {}
  for (const [level, line] of Object.entries(value.levels)) {
    if (line.trim() !== '') out[level] = line.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function budgetFromWire(
  value: { minimal: number; low: number; medium: number; high: number } | undefined,
): BudgetDraft {
  return {
    minimal: numToText(value?.minimal),
    low: numToText(value?.low),
    medium: numToText(value?.medium),
    high: numToText(value?.high),
  }
}

function budgetToWire(
  value: BudgetDraft,
): { minimal: number; low: number; medium: number; high: number } | undefined {
  const out: Record<string, number> = {}
  for (const key of ['minimal', 'low', 'medium', 'high'] as const) {
    const num = toNum(value[key])
    if (num !== undefined) out[key] = num
  }
  return Object.keys(out).length > 0
    ? (out as { minimal: number; low: number; medium: number; high: number })
    : undefined
}

/** 剔除空值：undefined / '' / 空数组 / 空对象。 */
function omitEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) continue
    out[key] = value
  }
  return out
}

/** 卡片已认识的 wire 字段（其余进 extra 原样往返）。 */
const KNOWN_MODEL_KEYS = new Set([
  'id',
  'extends',
  'name',
  'contextWindow',
  'maxTokens',
  'input',
  'reasoningEfforts',
  'compat',
])

const KNOWN_PROVIDER_KEYS = new Set([
  'extends',
  'displayName',
  'api',
  'baseURL',
  'apiKeyEnv',
  'headers',
  'compat',
  'defaultContextWindow',
  'defaultMaxTokens',
  'defaultInput',
  'reasoning',
  'thinkingBudgets',
  'cacheRetention',
  'transport',
  'timeoutMs',
  'websocketConnectTimeoutMs',
  'streamIdleTimeoutMs',
  'maxRequestImageBytes',
  'retryPolicy',
  'models',
])

/** 摘出 wire 对象里卡片未认识的字段（undefined 值不保留）。 */
function extraOf(wire: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(wire)) {
    if (!known.has(key) && value !== undefined) out[key] = value
  }
  return out
}

function modelDraftFromWire(model: WireModel): ModelDraft {
  return {
    id: model.id,
    extends: model.extends ?? '',
    name: model.name ?? '',
    contextWindow: numToText(model.contextWindow),
    maxTokens: numToText(model.maxTokens),
    input: inputFromWire(model.input),
    reasoningEfforts: reasoningFromWire(model.reasoningEfforts),
    compat: { ...(model.compat ?? {}) },
    extra: extraOf(model as Record<string, unknown>, KNOWN_MODEL_KEYS),
  }
}

function modelToWire(model: ModelDraft): WireModel {
  const reasoningEfforts = reasoningToWire(model.reasoningEfforts)
  return {
    ...model.extra,
    ...(omitEmpty({
      id: model.id.trim(),
      extends: model.extends.trim(),
      name: model.name.trim(),
      contextWindow: toNum(model.contextWindow),
      maxTokens: toNum(model.maxTokens),
      input: inputToWire(model.input),
      ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
      compat: model.compat,
    }) as Record<string, unknown>),
  } as unknown as WireModel
}

function providerDraftFromWire(provider: WireProvider): ProviderDraft {
  return {
    extends: provider.extends ?? '',
    displayName: provider.displayName ?? '',
    api: provider.api ?? '',
    baseURL: provider.baseURL ?? '',
    apiKeyEnv: provider.apiKeyEnv ?? '',
    headers: headersToPairs(provider.headers),
    compat: { ...(provider.compat ?? {}) },
    defaultContextWindow: numToText(provider.defaultContextWindow),
    defaultMaxTokens: numToText(provider.defaultMaxTokens),
    input: inputFromWire(provider.defaultInput),
    reasoning: provider.reasoning ?? '',
    thinkingBudgets: budgetFromWire(provider.thinkingBudgets),
    cacheRetention: provider.cacheRetention ?? '',
    transport: provider.transport ?? '',
    timeoutMs: numToText(provider.timeoutMs),
    websocketConnectTimeoutMs: numToText(provider.websocketConnectTimeoutMs),
    streamIdleTimeoutMs: numToText(provider.streamIdleTimeoutMs),
    maxRequestImageBytes: numToText(provider.maxRequestImageBytes),
    retryPolicy: provider.retryPolicy,
    models: (provider.models ?? []).map(modelDraftFromWire),
    extra: extraOf(provider as Record<string, unknown>, KNOWN_PROVIDER_KEYS),
  }
}

function providerToWire(provider: ProviderDraft): WireProvider {
  return {
    ...provider.extra,
    ...(omitEmpty({
      extends: provider.extends.trim(),
      displayName: provider.displayName.trim(),
      api: provider.api,
      baseURL: provider.baseURL.trim(),
      apiKeyEnv: provider.apiKeyEnv.trim(),
      headers: pairsToHeaders(provider.headers),
      compat: provider.compat,
      defaultContextWindow: toNum(provider.defaultContextWindow),
      defaultMaxTokens: toNum(provider.defaultMaxTokens),
      defaultInput: inputToWire(provider.input),
      reasoning: provider.reasoning,
      thinkingBudgets: budgetToWire(provider.thinkingBudgets),
      cacheRetention: provider.cacheRetention,
      transport: provider.transport,
      timeoutMs: toNum(provider.timeoutMs),
      websocketConnectTimeoutMs: toNum(provider.websocketConnectTimeoutMs),
      streamIdleTimeoutMs: toNum(provider.streamIdleTimeoutMs),
      maxRequestImageBytes: toNum(provider.maxRequestImageBytes),
      retryPolicy: provider.retryPolicy,
      models: provider.models.map(modelToWire),
    }) as Record<string, unknown>),
  } as unknown as WireProvider
}

export function emptyProviderDraft(): ProviderDraft {
  return {
    extends: '',
    displayName: '',
    api: '',
    baseURL: '',
    apiKeyEnv: '',
    headers: [],
    compat: {},
    defaultContextWindow: '',
    defaultMaxTokens: '',
    input: { text: false, image: false },
    reasoning: '',
    thinkingBudgets: { minimal: '', low: '', medium: '', high: '' },
    cacheRetention: '',
    transport: '',
    timeoutMs: '',
    websocketConnectTimeoutMs: '',
    streamIdleTimeoutMs: '',
    maxRequestImageBytes: '',
    retryPolicy: undefined,
    models: [],
    extra: {},
  }
}

export function emptyModelDraft(): ModelDraft {
  return {
    id: '',
    extends: '',
    name: '',
    contextWindow: '',
    maxTokens: '',
    input: { text: false, image: false },
    reasoningEfforts: { nonReasoning: false, levels: {} },
    compat: {},
    extra: {},
  }
}

export function draftFromValue(value: ConfigValue): Draft {
  return {
    enabled: value.enabled,
    catalogUrl: value.catalogUrl,
    catalogRefreshHours: String(value.catalogRefreshHours),
    catalogProxy: value.catalogProxy,
    providers: Object.fromEntries(
      Object.entries(value.providers).map(([route, provider]) => [
        route,
        providerDraftFromWire(provider),
      ]),
    ),
  }
}

/** 提交补丁：完整配置对象，providers 全量替换；空值一律剔除。 */
export function toPatch(draft: Draft): ConfigPatch {
  return {
    enabled: draft.enabled,
    catalogUrl: draft.catalogUrl.trim(),
    catalogRefreshHours: toNum(draft.catalogRefreshHours),
    catalogProxy: draft.catalogProxy.trim(),
    providers: Object.fromEntries(
      Object.entries(draft.providers).map(([route, provider]) => [route, providerToWire(provider)]),
    ),
  }
}
