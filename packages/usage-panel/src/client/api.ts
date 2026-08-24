/**
 * 数据端点通道：GET data / POST scan / POST prices-import（同源 fetch）。
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

export interface UsageData {
  generatedAt: string
  currency: string
  pricedCount: number
  scanning: { total: number; done: number } | null
  sessions: number
  rows: UsageWireRow[]
}

export async function fetchUsageData(): Promise<UsageData> {
  return getJson<UsageData>('/dsh-plus/usage-panel/data')
}

export async function startScan(): Promise<{ ok: boolean; error?: string }> {
  return postJson<{ ok: boolean; error?: string }>('/dsh-plus/usage-panel/scan')
}

export async function importPricesFromModelsDev(doc: string): Promise<{ imported: number }> {
  return postJson<{ imported: number }>('/dsh-plus/usage-panel/prices-import', { doc })
}

/** 浏览器直接拉 models.dev（经配置的代理由 host 转发不可行时退回直连提示）。 */
export async function fetchModelsDevRaw(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'omit' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
