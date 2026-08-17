import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ModelsDevSource } from '../src/catalog/models-dev.ts'

const UNREACHABLE = 'http://127.0.0.1:1/unreachable'

function fixtureFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llm-pi-md-test-'))
  return join(dir, 'models-dev.json')
}

test('catalogRefreshHours=0：不自动拉取，无缓存时保持无数据', async () => {
  const logs: string[] = []
  const source = new ModelsDevSource(fixtureFile(), UNREACHABLE, 0, (m) => logs.push(m))
  await source.ensureLoaded()
  assert.equal(source.enabled, false)
  assert.equal(source.status().fetchedAt, null)
  assert.equal(source.status().error, null)
  assert.equal(logs.length, 0)
  assert.equal(source.lookup('acme-lab', 'acme-huge'), undefined)
})

test('catalogRefreshHours=0：手动 refresh 仍强制拉取（失败记录错误，不静默）', async () => {
  const logs: string[] = []
  const source = new ModelsDevSource(fixtureFile(), UNREACHABLE, 0, (m) => logs.push(m))
  await source.ensureLoaded()
  await source.refresh()
  assert.notEqual(source.status().error, null)
  assert.ok(logs.some((m) => m.includes('models.dev 目录拉取失败')))
})

test('catalogRefreshHours=0 但已有缓存：数据可用（兜底源不因关闭自动拉取而失效）', async () => {
  const file = fixtureFile()
  writeFileSync(
    file,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      data: {
        'acme-lab': { id: 'acme-lab', models: { 'acme-huge': { id: 'acme-huge', name: 'Acme Huge' } } },
      },
    }),
  )
  const source = new ModelsDevSource(file, UNREACHABLE, 0, () => {})
  await source.ensureLoaded()
  assert.equal(source.enabled, true)
  assert.equal(source.status().providers, 1)
  assert.equal(source.lookup('acme-lab', 'acme-huge')?.name, 'Acme Huge')
})

test('catalogRefreshHours>0 且无缓存：自动拉取被触发（失败记录错误）', async () => {
  const logs: string[] = []
  const source = new ModelsDevSource(fixtureFile(), UNREACHABLE, 24, (m) => logs.push(m))
  await source.ensureLoaded()
  assert.notEqual(source.status().error, null)
  assert.ok(logs.some((m) => m.includes('models.dev 目录拉取失败')))
})

test('reconfigure 只更新参数：ttl 仍为 0 时不自动拉取', async () => {
  const logs: string[] = []
  const source = new ModelsDevSource(fixtureFile(), UNREACHABLE, 0, (m) => logs.push(m))
  await source.ensureLoaded()
  source.reconfigure('https://example.com/api.json', 0, 'http://127.0.0.1:7890')
  assert.equal(logs.length, 0)
  assert.equal(source.status().error, null)
})
