/**
 * 内置目录浏览后端：模糊匹配分级、多词 AND、筛选、分页、路径 id 与字段透传。
 * 直接对官方 vendored 目录做集成断言（目录随版本变化的部分只断言结构不变量），
 * 纯匹配逻辑用合成夹具断言分级。
 * @module @dsh-plus/llm-pi/tests/catalog-browse
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BROWSE_DEFAULT_LIMIT,
  BROWSE_MAX_LIMIT,
  browseModels,
  buildApiIndex,
  fuzzyScore,
  listModelInfos,
  listProviders,
} from '../src/catalog/browse.ts'
import { loadVendoredKit } from '../src/resolve-dsh.ts'

const kit = loadVendoredKit()

test('fuzzyScore 分级：相等 < 前缀 < 词首 < 子串 < 归一化 < 子序列；不匹配为 undefined', () => {
  const exact = fuzzyScore('deepseek-flash', 'deepseek-flash')
  const prefix = fuzzyScore('deep', 'deepseek-flash')
  const word = fuzzyScore('flash', 'deepseek-flash')
  const substring = fuzzyScore('seek-fl', 'deepseek-flash')
  const compact = fuzzyScore('deepseekflash', 'deepseek-flash')
  const subsequence = fuzzyScore('dsf', 'deepseek-flash')
  for (const [name, score] of Object.entries({
    exact,
    prefix,
    word,
    substring,
    compact,
    subsequence,
  })) {
    assert.notEqual(score, undefined, `${name} 应命中`)
  }
  const scores = [exact, prefix, word, substring, compact, subsequence] as number[]
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(
      (scores[i] as number) > (scores[i - 1] as number),
      `分级应严格递增：${scores[i - 1]} !< ${scores[i]}`,
    )
  }
  assert.equal(fuzzyScore('zzz', 'deepseek-flash'), undefined)
  assert.equal(fuzzyScore('', 'anything'), 0)
})

test('目录快照：provider 条目带显示名/模型数，模型事实含路径 id 与可服务标记', () => {
  const providers = listProviders(kit)
  assert.ok(providers.length > 10)
  for (const provider of providers) {
    assert.equal(typeof provider.id, 'string')
    assert.ok(provider.modelCount >= 0)
  }
  const infos = listModelInfos(kit)
  assert.ok(infos.length > 100)
  const flash = infos.find((info) => info.path === 'deepseek/deepseek-flash')
  assert.ok(flash)
  assert.equal(flash.id, 'deepseek-flash')
  assert.equal(flash.provider, 'deepseek')
  assert.equal(flash.api, 'openai-completions')
  assert.equal(flash.servable, true)
  assert.ok(flash.contextWindow > 0)
  assert.ok(flash.name.length > 0)
  // compat 与其余目录字段都带出来了（浏览器半据此展示参数明细）
  assert.equal((flash.compat as Record<string, unknown>)['thinkingFormat'], 'deepseek')
  assert.ok(Object.keys(flash.rest).length > 0)
})

test('搜索：多词 AND、路径优先、命中 provider 之名也可', () => {
  const deepFlash = browseModels(kit, { q: 'deep flash', limit: 5 })
  assert.ok(deepFlash.total > 0)
  assert.equal(deepFlash.items[0]?.path, 'deepseek/deepseek-flash')

  // provider 名参与匹配：'kimi coding' 前若干名必须是该 provider 的模型
  // （缩写匹配要求首字符落在词首，故不会把 granite 之类无关路径捞进来）
  const byProvider = browseModels(kit, { q: 'kimi coding', limit: 3 })
  assert.ok(byProvider.items.every((item) => item.path.startsWith('kimi-coding/')))
  // 首字母缩写仍可用（词首起）
  assert.equal(browseModels(kit, { q: 'dsf', limit: 1 }).items[0]?.path, 'deepseek/deepseek-flash')

  // 多词里只要有一个词没命中，整条不命中
  assert.equal(browseModels(kit, { q: 'deep zzzzz' }).total, 0)
})

test('筛选：provider / api / 能力 / 可服务开关', () => {
  const byProvider = browseModels(kit, { provider: 'deepseek', limit: BROWSE_MAX_LIMIT })
  assert.ok(byProvider.total > 0)
  assert.ok(byProvider.items.every((item) => item.provider === 'deepseek'))

  const anthropic = browseModels(kit, { api: 'anthropic-messages', limit: BROWSE_MAX_LIMIT })
  assert.ok(anthropic.total > 0)
  assert.ok(anthropic.items.every((item) => item.api === 'anthropic-messages'))

  const reasoning = browseModels(kit, { reasoning: true, limit: BROWSE_MAX_LIMIT })
  assert.ok(reasoning.items.every((item) => item.reasoning))

  const images = browseModels(kit, { image: true, limit: BROWSE_MAX_LIMIT })
  assert.ok(images.total > 0)
  assert.ok(images.items.every((item) => item.input.includes('image')))

  // 仅可服务（缺省）时被隐藏的条数 = 关掉开关后多出来的条数
  const all = browseModels(kit, { servableOnly: false, limit: BROWSE_MAX_LIMIT })
  const servable = browseModels(kit, { limit: BROWSE_MAX_LIMIT })
  assert.ok(all.total > servable.total)
  assert.equal(all.total - servable.total, servable.servableHidden)
  // 关掉开关后能直接看到不可服务的模型（且这时没有"隐藏"计数）
  const unservable = browseModels(kit, {
    servableOnly: false,
    q: 'gemini',
    limit: BROWSE_MAX_LIMIT,
  })
  assert.ok(unservable.items.some((item) => !item.servable))
  assert.equal(unservable.servableHidden, 0)
})

test('分页：offset/limit 生效，limit 有上限，越界返回空页', () => {
  const first = browseModels(kit, { provider: 'openai', limit: 3, offset: 0 })
  const second = browseModels(kit, { provider: 'openai', limit: 3, offset: 3 })
  assert.equal(first.items.length, 3)
  assert.equal(second.offset, 3)
  assert.notDeepEqual(
    first.items.map((item) => item.path),
    second.items.map((item) => item.path),
  )
  const huge = browseModels(kit, { limit: 10_000 })
  assert.equal(huge.limit, BROWSE_MAX_LIMIT)
  const outOfRange = browseModels(kit, { provider: 'deepseek', offset: 9999 })
  assert.deepEqual(outOfRange.items, [])
  assert.equal(browseModels(kit, {}).limit, BROWSE_DEFAULT_LIMIT)
})

test('协议索引：provider → modelId → api，覆盖全部模型', () => {
  const infos = listModelInfos(kit)
  const index = buildApiIndex(infos)
  assert.equal(index['deepseek']?.['deepseek-flash'], 'openai-completions')
  assert.equal(index['kimi-coding']?.['k3'], 'anthropic-messages')
  const indexed = Object.values(index).reduce(
    (total, models) => total + Object.keys(models).length,
    0,
  )
  assert.equal(indexed, infos.length)
})
