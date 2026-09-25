/**
 * 费用估算数学（纯函数）：按 per-Mtok 价目把 token 行折算为费用。
 * 价目按 resolvePrice 级联解析（精确 → 唯一命中 → 路由键提示 → 中位数兜底）；
 * 完全无候选 → null（UI 显示「—」，不臆造价格）。
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

/** 价目键：provider/model 维度身份（数组 JSON 串，无分隔符拼接歧义）。 */
function priceKey(entry: PriceEntry): string {
  return JSON.stringify([entry.provider, entry.model])
}

/**
 * 价目合并：同键（provider/model）以后者覆盖，块序按 base 首现位置。
 * 费用估算口径：导入价目（独立文件）为底、手工条目（config.prices）覆盖。
 */
export function mergePriceEntries(
  base: readonly PriceEntry[],
  over: readonly PriceEntry[],
): PriceEntry[] {
  const merged = new Map<string, PriceEntry>()
  for (const entry of base) merged.set(priceKey(entry), entry)
  for (const entry of over) merged.set(priceKey(entry), entry)
  return [...merged.values()]
}

export function findPrice(table: PriceTable, provider: string, model: string): PriceEntry | null {
  return table.entries.find((entry) => entry.provider === provider && entry.model === model) ?? null
}

/**
 * 路由键 → 提示 token（小写、按非字母数字切分）：用量行的 provider 是 llm 路由键
 * （如 `deepseek-official`），与 models.dev 的 provider id（如 `deepseek`）不同名，
 * 由 token 交集提供弱提示。
 */
function keyTokens(key: string): string[] {
  return key
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

/** 候选条目是否被路由键 token 命中（任一 token 相等即命中）。 */
function hinted(entry: PriceEntry, tokens: readonly string[]): boolean {
  const entryTokens = keyTokens(entry.provider)
  return tokens.some((token) => entryTokens.includes(token))
}

/**
 * 歧义消解：同一 model 多家 provider 价目且提示无法缩小时，取 input 非零候选中
 * inputPerMtok 中位数所在的代表条目（四项字段同源，不跨条目拼价）；全零（订阅制
 * 免费档）→ 任一零价条目。排序带 provider/model 次序，保证确定性。
 */
function medianEntry(candidates: readonly PriceEntry[]): PriceEntry {
  const nonzero = candidates.filter((entry) => entry.inputPerMtok > 0)
  const pool = nonzero.length > 0 ? nonzero : [...candidates]
  const sorted = [...pool].sort(
    (a, b) =>
      a.inputPerMtok - b.inputPerMtok ||
      a.provider.localeCompare(b.provider) ||
      a.model.localeCompare(b.model),
  )
  return sorted[Math.floor((sorted.length - 1) / 2)] as PriceEntry
}

/**
 * 价目解析级联（费用估算主入口）：
 * 1. 精确 (provider, model)——手工条目与同名路由直取；
 * 2. model 唯一命中——路由键与 models.dev 不同名但 model id 唯一时直取；
 * 3. 路由键 token 提示——从同 model 候选中筛提示命中者（仍多者按 4 消解）；
 * 4. 多候选无提示——中位数代表条目兜底（估算口径，避免整行「—」）；
 * 5. 无候选（含「—」聚合行）→ null，不臆造价格。
 */
export function resolvePrice(
  table: PriceTable,
  provider: string,
  model: string,
): PriceEntry | null {
  const exact = findPrice(table, provider, model)
  if (exact !== null) return exact
  const byModel = table.entries.filter((entry) => entry.model === model)
  if (byModel.length === 0) return null
  if (byModel.length === 1) return byModel[0] as PriceEntry
  const hintedEntries = byModel.filter((entry) => hinted(entry, keyTokens(provider)))
  const pool = hintedEntries.length > 0 ? hintedEntries : byModel
  return pool.length === 1 ? (pool[0] as PriceEntry) : medianEntry(pool)
}

function price(entry: PriceEntry | null, field: keyof PriceEntry): number {
  const value = entry?.[field]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * 估算一行费用（货币单位字符串保留 2 位小数足够展示；内部按 number 计）。
 * 价目按 resolvePrice 级联解析；无任何候选 → null；有价目 → tokens × per-Mtok / 1M 的四项和。
 */
export function estimateCost(row: UsageRow, table: PriceTable): number | null {
  const entry = resolvePrice(table, row.provider, row.model)
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
