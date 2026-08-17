import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildAuditRecord, createJsonlAuditSink } from '../src/audit.ts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('given a long body, when building the audit record, then excerpt is bounded', () => {
  const record = buildAuditRecord('主题', 'x'.repeat(5000), ['a@b.c'], 'sent')
  assert.equal(record.result, 'sent')
  assert.ok(record.bodyExcerpt.length <= 2001)
  assert.deepEqual(record.to, ['a@b.c'])
})

test('given a jsonl sink, when recording two sends, then both lines land and contain no secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dne-audit-'))
  try {
    const errors: string[] = []
    const sink = createJsonlAuditSink(join(dir, 'nested', 'audit.jsonl'), (m) => errors.push(m))
    sink(buildAuditRecord('第一封', '正文一', ['a@b.c'], 'dry-run'))
    sink(buildAuditRecord('第二封', '正文二', ['a@b.c'], 'sent'))
    await sleep(100)
    const lines = (await readFile(join(dir, 'nested', 'audit.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 2)
    const first = JSON.parse(lines[0] ?? '{}')
    assert.equal(first.subject, '第一封')
    assert.equal(first.result, 'dry-run')
    assert.equal(errors.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
