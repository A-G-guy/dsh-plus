/**
 * 自定义端点通道：仅剩「模型目录」（配置读写已迁移到官方 settingsScope
 * 传输，见 scope.ts 与 card.tsx）。
 * @module subagent-model/client/api
 */

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

const ROUTE_CATALOG = '/dsh-plus/subagent-model/catalog'

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

export async function fetchCatalog(): Promise<ModelCatalog> {
  return parse<ModelCatalog>(await fetch(ROUTE_CATALOG, { credentials: 'same-origin' }))
}
