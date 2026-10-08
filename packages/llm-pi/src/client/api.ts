/**
 * 自定义端点通道：只剩浏览器半拿不到的两样东西——运行期套件事实（生效版本、
 * 协议集合、目录规模、诊断）与 pi-ai 内置目录搜索（配置读写走 ctx.remote.settings
 * 直连，见 card.tsx / shared 的 scope.ts）。
 * @module llm-pi/client/api
 */

import type { CompatValue } from './constants.ts'

/** 运行期套件事实（服务端 kitInfo() 的镜像）。 */
export interface WireKitInfo {
  source: string
  root?: string
  versions: { piAi?: string; piAiAdapter?: string; dsh?: string }
  verifiedRange: string
  versionNotice?: string
  protocols: string[]
  protocolSource: string
  catalog: { providers: number; models: number; generatedAt?: number }
  compatSource: string
  /** 官方应急副本状态（服务端 official-copy-writer 的 OfficialCopyStatus 镜像）。 */
  officialCopy: {
    path: string
    updatedAt?: number
    routes: number
    warnings: string[]
    error?: string
  }
  diagnostics: WireDiagnostic[]
}

/** 套件诊断条目（服务端 KitDiagnostic 的镜像）。 */
export interface WireDiagnostic {
  /** info = 打包形态说明（非缺陷）；degradation = 回退与逐项降级。 */
  level: 'info' | 'degradation'
  message: string
}

/** 内置 provider 条目。 */
export interface WireProviderEntry {
  id: string
  name: string
  baseUrl?: string
  modelCount: number
}

export interface WireProvider {
  extends?: string
  displayName?: string
  api?: string
  baseURL?: string
  apiKeyEnv?: string
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  defaultContextWindow?: number
  defaultMaxTokens?: number
  defaultInput?: string[]
  reasoning?: string
  thinkingBudgets?: {
    minimal: number
    low: number
    medium: number
    high: number
  }
  cacheRetention?: string
  transport?: string
  timeoutMs?: number
  websocketConnectTimeoutMs?: number
  streamIdleTimeoutMs?: number
  maxRequestImageBytes?: number
  retryPolicy?: unknown
  models?: WireModel[]
}

export interface WireModel {
  id: string
  extends?: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: string[]
  reasoningEfforts?: false | Record<string, string | null>
  compat?: Record<string, unknown>
}

/** settings 命名空间的解析值（llm-pi 无 secret 字段，value 即完整配置）。 */
export interface ConfigValue {
  enabled: boolean
  providers: Record<string, WireProvider>
}

/** 保存提交形状：完整配置对象，providers 全量替换（settings.replace 语义）。 */
export type ConfigPatch = ConfigValue

/** compat 字段表（服务端从官方包推导后下发；浏览器半不手抄）。 */
export interface WireCompatTable {
  fields: Record<string, Record<string, CompatValue>>
  source: string
  problem?: string
}

/** 内置目录的单个模型（服务端 catalog/browse.ts 的镜像）。 */
export interface WireModelInfo {
  provider: string
  id: string
  path: string
  name: string
  api: string
  baseUrl: string
  contextWindow: number
  maxTokens: number
  input: string[]
  reasoning: boolean
  thinkingLevelMap?: Record<string, string | null>
  compat?: Record<string, unknown>
  /** 目录给出但未单列的其余字段（cost / inputLimits 等），原样展示。 */
  rest: Record<string, unknown>
  /** 当前生效协议集合能否服务该模型。 */
  servable: boolean
}

/** `GET /catalog` 响应：运行期事实 + provider/协议索引 + compat 字段表。 */
export interface CatalogMeta {
  kit: WireKitInfo
  providers: WireProviderEntry[]
  /** `{provider: {modelId: api}}`：推断 route 生效协议用。 */
  apis: Record<string, Record<string, string>>
  compat: WireCompatTable
}

/** `GET /catalog/models` 响应。 */
export interface CatalogPage {
  total: number
  servableHidden: number
  offset: number
  limit: number
  items: WireModelInfo[]
}

/** 目录搜索条件（与 server 端同名参数一一对应）。 */
export interface CatalogQuery {
  q?: string
  provider?: string
  api?: string
  reasoning?: boolean
  image?: boolean
  servableOnly?: boolean
  offset?: number
  limit?: number
}

const ROUTE_CATALOG = '/dsh-plus/llm-pi/catalog'

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

/** 运行期事实 + 目录索引（卡片挂载时一次）。 */
export async function fetchCatalogMeta(): Promise<CatalogMeta> {
  return parse<CatalogMeta>(await fetch(ROUTE_CATALOG, { credentials: 'same-origin' }))
}

/** 目录搜索（模糊 q + provider/api/能力/分页）。 */
export async function searchCatalog(
  query: CatalogQuery,
  signal?: AbortSignal,
): Promise<CatalogPage> {
  const params = new URLSearchParams()
  if (query.q !== undefined && query.q.length > 0) params.set('q', query.q)
  if (query.provider !== undefined && query.provider.length > 0)
    params.set('provider', query.provider)
  if (query.api !== undefined && query.api.length > 0) params.set('api', query.api)
  if (query.reasoning === true) params.set('reasoning', '1')
  if (query.image === true) params.set('image', '1')
  if (query.servableOnly === false) params.set('servable', '0')
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const suffix = params.toString()
  return parse<CatalogPage>(
    await fetch(`${ROUTE_CATALOG}/models${suffix === '' ? '' : `?${suffix}`}`, {
      credentials: 'same-origin',
      ...(signal === undefined ? {} : { signal }),
    }),
  )
}
