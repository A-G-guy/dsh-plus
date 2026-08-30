/**
 * 自定义端点通道：仅剩「模型目录」（配置读写已迁移到 ctx.remote.settings
 * 直连传输，0.1.2-alpha.1 起 connection.api.settings 已移除；见 scope.ts 与
 * card.tsx）。目录响应附带 kitSource 与 models-dev 状态，供卡片的状态行
 * 展示（运行期诊断，非配置数据）。
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
  catalogUrl: string
  catalogRefreshHours: number
  catalogProxy: string
  providers: Record<string, WireProvider>
}

/** 保存提交形状：完整配置对象，providers 全量替换（settings.replace 语义）。 */
export type ConfigPatch = ConfigValue

/** GET /catalog?provider=&source= 返回（kitSource 为运行期套件来源诊断）。 */
export interface CatalogResult {
  providers: string[]
  models: string[]
  status?: WireModelsDevStatus
  kitSource?: string
}

const ROUTE_CATALOG = '/dsh-plus/llm-pi/catalog'

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

/** 目录查询：provider 为空时只返回该源的 provider 列表。 */
export async function fetchCatalog(
  provider: string,
  source: 'builtin' | 'models-dev',
): Promise<CatalogResult> {
  const url = `${ROUTE_CATALOG}?provider=${encodeURIComponent(provider)}&source=${source}`
  return parse<CatalogResult>(await fetch(url, { credentials: 'same-origin' }))
}

/** 手动拉取 models.dev 目录：POST /catalog/refresh → 最新快照状态。 */
export async function refreshCatalog(): Promise<{
  status: WireModelsDevStatus
}> {
  return parse<{ status: WireModelsDevStatus }>(
    await fetch(`${ROUTE_CATALOG}/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
    }),
  )
}
