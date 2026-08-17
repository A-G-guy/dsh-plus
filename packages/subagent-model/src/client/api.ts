/**
 * 配置卡片数据通道：同源 fetch 调自建 webServer 路由。
 * （官方 settings.* RPC 白名单硬编码不含第三方 namespace，见 config-api.ts 注释。）
 * @module subagent-model/client/api
 */

export interface WireEntry {
  enabled: boolean
  provider: string
  model: string
  reasoningEffort: string
}

export interface WireConfig {
  enabled: boolean
  entries: Record<string, WireEntry>
  subagentProviders: string[]
  writable: boolean
}

export interface WirePatch {
  enabled: boolean
  entries: Record<string, WireEntry>
}

export interface CatalogEffort {
  id: string
  name: string
  description?: string
}

export interface CatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: {
    defaultEffort?: string
    efforts: CatalogEffort[]
  }
}

export interface CatalogProvider {
  id: string
  name: string
  models: CatalogModel[]
}

export interface ModelCatalog {
  providers: CatalogProvider[]
  failures: { id: string; name: string; message: string }[]
  subagentProviders: string[]
}

const ROUTE_CONFIG = '/dsh-custom/subagent-model/config'
const ROUTE_CATALOG = '/dsh-custom/subagent-model/catalog'

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

export async function fetchConfig(): Promise<WireConfig> {
  return parse<WireConfig>(await fetch(ROUTE_CONFIG, { credentials: 'same-origin' }))
}

export async function saveConfig(patch: WirePatch): Promise<WireConfig> {
  return parse<WireConfig>(
    await fetch(ROUTE_CONFIG, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  )
}

export async function fetchCatalog(): Promise<ModelCatalog> {
  return parse<ModelCatalog>(await fetch(ROUTE_CATALOG, { credentials: 'same-origin' }))
}
