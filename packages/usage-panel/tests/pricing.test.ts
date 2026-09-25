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
  resolvePrice,
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
  // 无价目行需 model 也无候选（仅 provider 不同、model 有唯一候选时按级联会命中）
  const mixed = [row({ inputTokens: 1_000_000 }), row({ provider: 'zzz', model: 'nope' })]
  assert.equal(totalCost(mixed, table), 8)
  assert.equal(totalCost([row({ provider: 'zzz', model: 'nope' })], table), null)
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

// ---- resolvePrice 级联（路由键与 models.dev 键不同名的匹配口径） ----

function full(provider: string, model: string, input: number): PriceEntry {
  return {
    provider,
    model,
    inputPerMtok: input,
    outputPerMtok: input * 3,
    cacheReadPerMtok: 0,
    cacheWritePerMtok: 0,
  }
}

test('resolvePrice：精确 (provider, model) 优先于任何级联', () => {
  const t: PriceTable = { currency: 'CNY', entries: [full('a', 'm', 1), full('b', 'm', 9)] }
  assert.equal(resolvePrice(t, 'b', 'm')?.inputPerMtok, 9)
})

test('resolvePrice：路由键不同名但 model 唯一 → 直取该候选', () => {
  // Given：用量行是路由键（anthropic/kimi-coding），价目键是 models.dev 键
  const t: PriceTable = { currency: 'CNY', entries: [full('kimi-for-coding', 'k3-256k', 4)] }
  // When-Then
  assert.equal(resolvePrice(t, 'anthropic', 'k3-256k')?.inputPerMtok, 4)
  assert.equal(resolvePrice(t, 'kimi-coding', 'k3-256k')?.inputPerMtok, 4)
})

test('resolvePrice：多候选时路由键 token 提示缩小范围（deepseek-official → deepseek）', () => {
  const t: PriceTable = {
    currency: 'CNY',
    entries: [full('deepseek', 'deepseek-v4-flash', 1), full('azure', 'deepseek-v4-flash', 2)],
  }
  // 提示命中 → 官方条目；无提示路由 → 不命中提示，落入中位数
  assert.equal(resolvePrice(t, 'deepseek-official', 'deepseek-v4-flash')?.provider, 'deepseek')
  assert.equal(resolvePrice(t, 'newapi-chat', 'deepseek-v4-flash')?.inputPerMtok, 1)
})

test('resolvePrice：多候选无提示 → input 非零中位数代表条目（字段同源）', () => {
  // Given：五家价目，含一条订阅制 0 价（不参与非零中位数）
  const t: PriceTable = {
    currency: 'CNY',
    entries: [
      full('p1', 'm', 1),
      full('p2', 'm', 0),
      full('p3', 'm', 3),
      full('p4', 'm', 5),
      full('p5', 'm', 7),
    ],
  }
  // When：非零候选 [1,3,5,7] → 中位取下中位 3，四项字段取自同一条目
  const hit = resolvePrice(t, 'newapi-chat', 'm')
  // Then
  assert.equal(hit?.provider, 'p3')
  assert.equal(hit?.inputPerMtok, 3)
  assert.equal(hit?.outputPerMtok, 9)
})

test('resolvePrice：候选全为 0 价 → 零价条目（估 0 而非「—」）', () => {
  const t: PriceTable = { currency: 'CNY', entries: [full('z1', 'm', 0), full('z2', 'm', 0)] }
  assert.equal(resolvePrice(t, 'any-route', 'm')?.inputPerMtok, 0)
})

test('resolvePrice：无候选（含「—」聚合行）→ null', () => {
  const t: PriceTable = { currency: 'CNY', entries: [full('a', 'm', 1)] }
  assert.equal(resolvePrice(t, 'a', 'nope'), null)
  assert.equal(resolvePrice(t, '—', '—'), null)
  assert.equal(resolvePrice({ currency: 'CNY', entries: [] }, 'a', 'm'), null)
})

test('estimateCost：路由别名行经级联估算，不再返回 null', () => {
  // Given：价目只有 models.dev 键（deepseek/deepseek-v4-flash），行是路由键
  const t: PriceTable = {
    currency: 'CNY',
    entries: [full('deepseek', 'deepseek-v4-flash', 2)],
  }
  // When
  const cost = estimateCost(
    row({ provider: 'chat', model: 'deepseek-v4-flash', inputTokens: 1_000_000 }),
    t,
  )
  // Then：命中候选 → 2（而非 null →「—」）
  assert.equal(cost, 2)
})
