/**
 * 费用估算数学（纯函数）：按 per-Mtok 价目把 token 行折算为费用。
 * 价目缺省（未配置该 provider/model）→ null（UI 显示「—」，不臆造价格）。
 * @module usage-panel/pricing
 */
import type { UsageRow } from './usage-fold.ts'

/** 单条价目：每百万 token 单价（货币单位由配置的 currency 决定）。 */
export interface PriceEntry {
  provider: string
  model: string
  /** 每 1M input tokens 价格；缺省视为 0（免费）。 */
  inputPerMtok?: number
  outputPerMtok?: number
  cacheReadPerMtok?: number
  cacheWritePerMtok?: number
}

export interface PriceTable {
  currency: string
  entries: PriceEntry[]
}

const MTOK = 1_000_000

export function findPrice(table: PriceTable, provider: string, model: string): PriceEntry | null {
  return table.entries.find((entry) => entry.provider === provider && entry.model === model) ?? null
}

function price(entry: PriceEntry | null, field: keyof PriceEntry): number {
  const value = entry?.[field]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * 估算一行费用（货币单位字符串保留 2 位小数足够展示；内部按 number 计）。
 * 无价目 → null；有价目 → tokens × per-Mtok / 1M 的四项和。
 */
export function estimateCost(row: UsageRow, table: PriceTable): number | null {
  const entry = findPrice(table, row.provider, row.model)
  if (entry === null) return null
  const cost =
    (row.inputTokens * price(entry, 'inputPerMtok') +
      row.outputTokens * price(entry, 'outputPerMtok') +
      row.cacheReadTokens * price(entry, 'cacheReadPerMtok') +
      row.cacheWriteTokens * price(entry, 'cacheWritePerMtok')) /
    MTOK
  return cost
}

/** 费用展示格式：null → '—'；否则固定 2 位小数（<0.01 显示更多位防湮灭）。 */
export function formatCost(cost: number | null, currency: string): string {
  if (cost === null) return '—'
  const abs = Math.abs(cost)
  const digits = abs > 0 && abs < 0.01 ? 4 : 2
  return `${cost.toFixed(digits)} ${currency}`
}

/** 多行合计费用；全部无价目 → null。 */
export function totalCost(rows: readonly UsageRow[], table: PriceTable): number | null {
  let sum: number | null = null
  for (const row of rows) {
    const cost = estimateCost(row, table)
    if (cost !== null) sum = (sum ?? 0) + cost
  }
  return sum
}
