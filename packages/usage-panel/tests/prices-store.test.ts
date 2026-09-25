/**
 * 价目独立存储：解析容错、原子落盘往返、目录缺席/损坏降级空文档。
 * Given-When-Then 注释标注各验收条件。
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { emptyPrices, loadPrices, parsePrices, savePrices } from '../src/prices-store.ts'

const sample = {
  updatedAt: '2026-09-25T00:00:00.000Z',
  entries: [
    {
      provider: 'openai',
      model: 'gpt-x',
      inputPerMtok: 2.5,
      outputPerMtok: 10,
      cacheReadPerMtok: 0.3,
      cacheWritePerMtok: 1.25,
    },
  ],
}

test('parsePrices：合法文档往返保留条目与导入时间', () => {
  // When
  const doc = parsePrices(JSON.stringify(sample))
  // Then
  assert.notEqual(doc, null)
  assert.equal(doc?.updatedAt, sample.updatedAt)
  assert.equal(doc?.entries.length, 1)
  assert.equal(doc?.entries[0]?.provider, 'openai')
  assert.equal(doc?.entries[0]?.inputPerMtok, 2.5)
})

test('parsePrices：sourceFetchedAt 三态——串/null 保留，缺席不产出（旧版视为无标注）', () => {
  // When-Then：目录来源标注
  const tagged = parsePrices(
    JSON.stringify({ updatedAt: 'x', sourceFetchedAt: '2026-09-25T01:17:11.724Z', entries: [] }),
  )
  assert.equal(tagged?.sourceFetchedAt, '2026-09-25T01:17:11.724Z')
  // When-Then：外部 doc 导入的 null 标注
  const manual = parsePrices(JSON.stringify({ updatedAt: 'x', sourceFetchedAt: null, entries: [] }))
  assert.equal(manual?.sourceFetchedAt, null)
  // When-Then：旧版文件（字段缺席）→ undefined，序列化也不产出该键
  const legacy = parsePrices(JSON.stringify(sample))
  assert.equal('sourceFetchedAt' in (legacy ?? {}), false)
  assert.equal(JSON.stringify(legacy).includes('sourceFetchedAt'), false)
})

test('parsePrices：损坏 JSON / 顶层数组 / entries 缺席 → null（降级空文档）', () => {
  // When-Then
  assert.equal(parsePrices('{broken'), null)
  assert.equal(parsePrices('[1,2]'), null)
  assert.equal(parsePrices('{"updatedAt":"x"}'), null)
  assert.equal(parsePrices('null'), null)
})

test('parsePrices：非法条目剔除、非法单价归 0，合法条目保留', () => {
  // When
  const doc = parsePrices(
    JSON.stringify({
      entries: [
        { provider: '', model: 'm', inputPerMtok: 1 },
        { provider: 'p', model: 'm', inputPerMtok: -1, outputPerMtok: 'x' },
        { provider: 'p', model: 7 },
        'nope',
      ],
    }),
  )
  // Then：空 provider 与非对象条目剔除，非法单价归 0
  assert.equal(doc?.entries.length, 1)
  assert.equal(doc?.entries[0]?.inputPerMtok, 0)
  assert.equal(doc?.entries[0]?.outputPerMtok, 0)
  assert.equal(doc?.updatedAt, null)
})

test('savePrices → loadPrices：原子落盘后往返一致，updatedAt 刷新', async () => {
  // Given：临时目录（/tmp），目标文件尚不存在
  const dir = await mkdtemp(join(tmpdir(), 'usage-panel-prices-'))
  const path = join(dir, 'prices.json')
  try {
    // When：写入（null = 外部 doc 来源标注）
    const saved = await savePrices(path, sample.entries, null)
    // Then：文件存在且内容自洽
    assert.equal(saved.entries.length, 1)
    assert.notEqual(saved.updatedAt, null)
    const raw = JSON.parse(await readFile(path, 'utf8')) as {
      entries: unknown[]
      sourceFetchedAt: null
    }
    assert.equal(raw.entries.length, 1)
    assert.equal(raw.sourceFetchedAt, null)
    // When：回读
    const loaded = await loadPrices(path)
    // Then：条目一致
    assert.equal(loaded.entries.length, 1)
    assert.equal(loaded.entries[0]?.model, 'gpt-x')
    assert.equal(loaded.updatedAt, saved.updatedAt)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadPrices：文件缺席 / 内容损坏 → 空文档（不抛错阻塞启动）', async () => {
  // Given：临时目录
  const dir = await mkdtemp(join(tmpdir(), 'usage-panel-prices-'))
  try {
    // When-Then：缺席
    const missing = await loadPrices(join(dir, 'absent.json'))
    assert.deepEqual(missing, emptyPrices())
    // When-Then：损坏
    const broken = join(dir, 'broken.json')
    await savePrices(broken, sample.entries, null)
    await writeFile(broken, '{not json', 'utf8')
    const damaged = await loadPrices(broken)
    assert.deepEqual(damaged, emptyPrices())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
