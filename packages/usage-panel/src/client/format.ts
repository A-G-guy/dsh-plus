/**
 * 展示格式化（纯函数）：tokens 缩写与费用文本。
 * @module usage-panel/client/format
 */

export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function fmtCost(cost: number | null, currency: string): string {
  if (cost === null) return '—'
  const abs = Math.abs(cost)
  return `${cost.toFixed(abs > 0 && abs < 0.01 ? 4 : 2)} ${currency}`
}

export function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}
