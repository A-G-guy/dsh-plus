import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pluginNameFromDetail, quarantinedNamesFromDoc } from '../src/lifeboat-bridge.ts'

test('given quarantine detail with standard format, when extracting plugin name, then name returned', () => {
  assert.equal(
    pluginNameFromDetail('dsh-plus-web-files（来源 host，已写入禁用）'),
    'dsh-plus-web-files',
  )
  assert.equal(
    pluginNameFromDetail('dsh-plus-llm-pi（来源 client，已存在禁用）'),
    'dsh-plus-llm-pi',
  )
})

test('given non-quarantine detail shapes, when extracting, then null', () => {
  assert.equal(pluginNameFromDetail('普通记录'), null)
  assert.equal(pluginNameFromDetail(''), null)
  assert.equal(pluginNameFromDetail(undefined), null)
  assert.equal(pluginNameFromDetail(42), null)
})

test('given lifeboat journal doc, when extracting quarantined set, then only quarantine entries counted', () => {
  const doc = {
    journal: [
      {
        at: '2026-01-01T00:00:00Z',
        kind: 'quarantine',
        detail: 'dsh-plus-web-files（来源 host，已写入禁用）',
      },
      { at: '2026-01-01T00:01:00Z', kind: 'alert', detail: 'dsh-plus-web-files | 已隔离' },
      {
        at: '2026-01-01T00:02:00Z',
        kind: 'quarantine',
        detail: 'dsh-plus-notify-email（来源 client，已写入禁用）',
      },
      { at: '2026-01-01T00:03:00Z', kind: 'quarantine-error', detail: 'dsh-plus-reload: 写入失败' },
    ],
    llmFallback: null,
  }
  const names = quarantinedNamesFromDoc(doc)
  assert.ok(names.has('dsh-plus-web-files'))
  assert.ok(names.has('dsh-plus-notify-email'))
  assert.ok(!names.has('dsh-plus-reload'), 'quarantine-error 不是成功隔离记录')
  assert.equal(names.size, 2)
})

test('given malformed doc shapes, when extracting, then empty set without throwing', () => {
  assert.equal(quarantinedNamesFromDoc(undefined).size, 0)
  assert.equal(quarantinedNamesFromDoc(null).size, 0)
  assert.equal(quarantinedNamesFromDoc({}).size, 0)
  assert.equal(quarantinedNamesFromDoc({ journal: 'not-array' }).size, 0)
  assert.equal(quarantinedNamesFromDoc({ journal: [null, 42, 'x'] }).size, 0)
})
