/**
 * 配置卡片数据通道：同源 fetch 调自建 webServer 路由（notify-email 同款模式；
 * 官方 settings.* RPC 白名单硬编码不含第三方 namespace）。
 * @module llm-pi/client/api
 */

export interface WireModelsDevStatus {
  fetchedAt: string | null
  providers: number
  error: string | null
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
  thinkingBudgets?: { minimal: number; low: number; medium: number; high: number }
  cacheRetention?: string
  transport?: string
  timeoutMs?: number
  websocketConnectTimeoutMs?: number
  streamIdleTimeoutMs?: number
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

/** GET /config 返回（config.ts WireConfig）。 */
export interface WireConfig {
  enabled: boolean
  catalogUrl: string
  catalogRefreshHours: number
  catalogProxy: string
  providers: Record<string, WireProvider>
  writable: boolean
  kitSource: string
  modelsDevStatus: WireModelsDevStatus | null
}

/** PUT /config 提交形状（config.ts WirePatchInput；providers 全量替换）。 */
export interface WirePatchInput {
  enabled?: boolean
  catalogUrl?: string
  catalogRefreshHours?: number
  catalogProxy?: string
  providers?: Record<string, WireProvider>
}

/** GET /catalog?provider=&source= 返回。 */
export interface CatalogResult {
  providers: string[]
  models: string[]
  status?: WireModelsDevStatus
}

const ROUTE_CONFIG = '/dsh-plus/llm-pi/config'
const ROUTE_CATALOG = '/dsh-plus/llm-pi/catalog'

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

export async function fetchConfig(): Promise<WireConfig> {
  return parse<WireConfig>(await fetch(ROUTE_CONFIG, { credentials: 'same-origin' }))
}

export async function saveConfig(patch: WirePatchInput): Promise<WireConfig> {
  return parse<WireConfig>(
    await fetch(ROUTE_CONFIG, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  )
}

/** 目录查询：provider 为空时只返回该源的 provider 列表。 */
export async function fetchCatalog(provider: string, source: 'builtin' | 'models-dev'): Promise<CatalogResult> {
  const url = `${ROUTE_CATALOG}?provider=${encodeURIComponent(provider)}&source=${source}`
  return parse<CatalogResult>(await fetch(url, { credentials: 'same-origin' }))
}

/** 手动拉取 models.dev 目录：POST /catalog/refresh → 最新快照状态。 */
export async function refreshCatalog(): Promise<{ status: WireModelsDevStatus }> {
  return parse<{ status: WireModelsDevStatus }>(
    await fetch(`${ROUTE_CATALOG}/refresh`, { method: 'POST', credentials: 'same-origin' }),
  )
}
