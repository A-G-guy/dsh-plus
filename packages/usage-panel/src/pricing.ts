/**
 * 费用估算数学（纯函数）：按 per-Mtok 价目把 token 行折算为费用。
 * 价目缺省（未配置该 provider/model）→ null（UI 显示「—」，不臆造价格）。
 *
 * 价目 schema 与类型同源在此维护（config.ts 复用本文件的 PriceEntrySchema），
 * 避免「schema 一份、类型一份」两处漂移。浏览器半不引用本模块，schemas 不会
 * 进入客户端 bundle。
 * @module usage-panel/pricing
 */
import z from '@deepseek-ai/schemastery'

import type { UsageRow } from './usage-fold.ts'

/** 单条价目入参形态（schema 各字段有 default，故调用方可省略）。 */
export interface PriceEntryInput {
  provider?: string
  model?: string
  inputPerMtok?: number
  outputPerMtok?: number
  cacheReadPerMtok?: number
  cacheWritePerMtok?: number
}

/** 单条价目：每百万 token 单价（货币单位由配置的 currency 决定）。 */
export interface PriceEntry {
  provider: string
  model: string
  /** 每 1M input tokens 价格；0 视为免费。 */
  inputPerMtok: number
  outputPerMtok: number
  cacheReadPerMtok: number
  cacheWritePerMtok: number
}

// 显式标注而非 `any`：z.object() 的推断类型含 cosmokit 的 `& Dict` 索引签名，
// 直接导出会触发 TS2883（inferred type cannot be named / not portable）并使
// tsdown 的 dts 生成失败。标注成具名契约后既保住类型、又让产物可移植。
export const PriceEntrySchema: z<PriceEntryInput, PriceEntry> = z.object({
  provider: z.string().min(1).description('provider 路由键（与 llm 路由一致）').default(''),
  model: z.string().min(1).description('provider 内模型 id').default(''),
  inputPerMtok: z.number().min(0).description('每 1M 输入 tokens 单价').default(0),
  outputPerMtok: z.number().min(0).description('每 1M 输出 tokens 单价').default(0),
  cacheReadPerMtok: z.number().min(0).description('每 1M 缓存读 tokens 单价').default(0),
  cacheWritePerMtok: z.number().min(0).description('每 1M 缓存写 tokens 单价').default(0),
})

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
