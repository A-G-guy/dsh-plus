/**
 * 费用估算数学：per-Mtok 换算、缺价目 null 语义、合计与小额展示。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { estimateCost, formatCost, type PriceTable, totalCost } from '../src/pricing.ts'
import type { UsageRow } from '../src/usage-fold.ts'

const table: PriceTable = {
  currency: 'CNY',
  entries: [
    {
      provider: 'a',
      model: 'big',
      inputPerMtok: 8,
      outputPerMtok: 24,
      cacheReadPerMtok: 1,
      cacheWritePerMtok: 8,
    },
  ],
}

function row(over: Partial<UsageRow>): UsageRow {
  return {
    date: '2026-08-25',
    provider: 'a',
    model: 'big',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 1,
    ...over,
  }
}

test('per-Mtok 换算：tokens × 单价 / 1M', () => {
  const cost = estimateCost(
    row({ inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000 }),
    table,
  )
  assert.equal(cost, 8 + 12 + 2)
})

test('缺价目 → null（UI 显示「—」，不臆造价格）', () => {
  assert.equal(estimateCost(row({ provider: 'unknown', model: 'x' }), table), null)
})

test('多行合计；全无价目 → null', () => {
  const mixed = [row({ inputTokens: 1_000_000 }), row({ provider: 'zzz', inputTokens: 999 })]
  assert.equal(totalCost(mixed, table), 8)
  assert.equal(totalCost([row({ provider: 'zzz' })], table), null)
})

test('formatCost：null → em dash；常规 2 位小数；小额 4 位防湮灭', () => {
  assert.equal(formatCost(null, 'CNY'), '—')
  assert.equal(formatCost(1.5, 'CNY'), '1.50 CNY')
  assert.equal(formatCost(0.001, 'CNY'), '0.0010 CNY')
})
