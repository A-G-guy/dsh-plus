/**
 * 数据端点通道：GET data / GET|POST catalog / POST prices-import（同源 fetch）。
 * @module usage-panel/client/api
 */
import { getJson, postJson } from '@dsh-plus/shared/client'

export interface UsageWireRow {
  date: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  calls: number
  cost: number | null
}

export interface UsageSyncState {
  total: number
  done: number
  skipped: number
  lastError: string | null
  lastFinishedAt: string | null
  running: boolean
}

export interface UsageCatalogState {
  fetchedAt: string | null
  error: string | null
  refreshing: boolean
}

export interface UsageData {
  generatedAt: string
  currency: string
  pricedCount: number
  sync: UsageSyncState
  catalog: UsageCatalogState
  sessions: number
  rows: UsageWireRow[]
}

/** 端点应答形状守卫：rows 需为数组、sync/catalog 需为对象（渲染期直接消费）。 */
function isUsageData(value: unknown): value is UsageData {
  if (typeof value !== 'object' || value === null) return false
  const data = value as { rows?: unknown; sync?: unknown; catalog?: unknown }
  return (
    Array.isArray(data.rows) &&
    typeof data.sync === 'object' &&
    data.sync !== null &&
    typeof data.catalog === 'object' &&
    data.catalog !== null
  )
}

export async function fetchUsageData(): Promise<UsageData> {
  return getJson<UsageData>('/dsh-plus/usage-panel/data', isUsageData)
}

export async function fetchCatalogState(): Promise<UsageCatalogState> {
  return getJson<UsageCatalogState>('/dsh-plus/usage-panel/catalog')
}

export async function refreshCatalog(): Promise<void> {
  await postJson<{ ok: boolean }>('/dsh-plus/usage-panel/catalog')
}

export async function importPricesFromModelsDev(doc?: string): Promise<{ imported: number }> {
  return postJson<{ imported: number }>(
    '/dsh-plus/usage-panel/prices-import',
    doc === undefined ? {} : { doc },
  )
}
