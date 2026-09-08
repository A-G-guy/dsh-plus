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

export async function fetchUsageData(): Promise<UsageData> {
  return getJson<UsageData>('/dsh-plus/usage-panel/data')
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
