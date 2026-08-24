/**
 * models.dev 价目导入折算。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { importPrices } from '../src/models-dev.ts'

test('有 cost 的模型折算为条目；cache_read/write 字段映射', () => {
  const prices = importPrices({
    openai: {
      models: {
        'gpt-x': {
          cost: { input: 2.5, output: 10, cache_read: 0.3, cache_write: 1.25 },
        },
      },
    },
  })
  assert.equal(prices.length, 1)
  assert.equal(prices[0]?.provider, 'openai')
  assert.equal(prices[0]?.model, 'gpt-x')
  assert.equal(prices[0]?.inputPerMtok, 2.5)
  assert.equal(prices[0]?.cacheReadPerMtok, 0.3)
  assert.equal(prices[0]?.cacheWritePerMtok, 1.25)
})

test('无 cost / null cost 的模型跳过；provider 为 null 跳过', () => {
  const prices = importPrices({
    a: { models: { free: { cost: null as never }, paid: { cost: { input: 1 } } } },
    b: null,
  })
  assert.equal(prices.length, 1)
  assert.equal(prices[0]?.model, 'paid')
})

test('非数值单价按 0 处理（不产生 NaN）', () => {
  const prices = importPrices({
    a: { models: { m: { cost: { input: 'bad' as never } } } },
  })
  assert.equal(prices[0]?.inputPerMtok, 0)
})
