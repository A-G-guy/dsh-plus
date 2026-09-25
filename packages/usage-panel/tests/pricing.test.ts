/**
 * 费用估算数学：per-Mtok 换算、缺价目 null 语义、合计与小额展示；
 * 价目合并：导入（独立文件）为底、手工条目覆盖同键。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  estimateCost,
  formatCost,
  mergePriceEntries,
  type PriceEntry,
  type PriceTable,
  totalCost,
} from '../src/pricing.ts'
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

function entry(provider: string, model: string, input: number): PriceEntry {
  return {
    provider,
    model,
    inputPerMtok: input,
    outputPerMtok: 0,
    cacheReadPerMtok: 0,
    cacheWritePerMtok: 0,
  }
}

test('mergePriceEntries：手工条目覆盖导入同键，异键保留（手工优先口径）', () => {
  // Given：导入价目两条，手工改写其中一条
  const imported = [entry('a', 'big', 1), entry('b', 'm', 3)]
  const manual = [entry('a', 'big', 9)]
  // When
  const merged = mergePriceEntries(imported, manual)
  // Then：同键取手工值，异键保留，总数不去重丢项
  assert.equal(merged.length, 2)
  assert.equal(merged[0]?.inputPerMtok, 9)
  assert.equal(merged[1]?.provider, 'b')
})

test('mergePriceEntries：一侧为空 → 另一侧原样（条数一致）', () => {
  assert.equal(mergePriceEntries([entry('a', 'm', 1)], []).length, 1)
  assert.equal(mergePriceEntries([], [entry('a', 'm', 1)]).length, 1)
  assert.deepEqual(mergePriceEntries([], []), [])
})

test('mergePriceEntries：键为 provider/model 二元组，含空格不串键', () => {
  // When：两组 provider/model 拼接结果相同但二元组不同
  const merged = mergePriceEntries([entry('a b', 'c', 1)], [entry('a', 'b c', 2)])
  // Then：不误判同键（各自保留）
  assert.equal(merged.length, 2)
  assert.equal(merged[0]?.inputPerMtok, 1)
  assert.equal(merged[1]?.inputPerMtok, 2)
})
