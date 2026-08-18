import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import { createQuarantine, isGuardedPlugin } from '../src/quarantine.ts'

const fakeCtx = { logger: () => ({ warn: () => {} }) } as unknown as Context

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'lifeboat-q-'))
  const patchFile = join(dir, 'cordis.patch.yml')
  await writeFile(patchFile, '[]\n', 'utf-8')
  const journals: string[] = []
  const alerts: string[] = []
  const q = createQuarantine(fakeCtx, {
    patchFile,
    alertCooldownMs: 60_000,
    journal: (kind, detail) => journals.push(`${kind}:${detail}`),
    alert: (subject) => alerts.push(subject),
  })
  return { dir, patchFile, journals, alerts, q }
}

test('given plugin names, when guarding, then only dsh-plus siblings pass', () => {
  assert.ok(isGuardedPlugin('dsh-plus-llm-pi'))
  assert.ok(!isGuardedPlugin('dsh-plus-lifeboat'))
  assert.ok(!isGuardedPlugin('dsh-plus-bundle-main'))
  assert.ok(!isGuardedPlugin('app-shell'))
  assert.ok(!isGuardedPlugin(undefined))
})

test('given sibling failure, when quarantining, then patch written and alerted', async () => {
  const { dir, patchFile, alerts, q } = await setup()
  try {
    await q.quarantine('dsh-plus-x', 'host')
    const text = await readFile(patchFile, 'utf-8')
    assert.match(text, /id: dsh-plus-x/)
    assert.equal(alerts.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('given repeated failure within cooldown, when quarantining, then no duplicate write or alert', async () => {
  const { dir, patchFile, alerts, q } = await setup()
  try {
    await q.quarantine('dsh-plus-x', 'host')
    await q.quarantine('dsh-plus-x', 'client')
    assert.equal((await readFile(patchFile, 'utf-8')).match(/dsh-plus-x/g)?.length, 1)
    assert.equal(alerts.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('given official plugin name, when quarantining, then ignored', async () => {
  const { dir, patchFile, alerts, q } = await setup()
  try {
    await q.quarantine('app-shell', 'host')
    assert.equal(await readFile(patchFile, 'utf-8'), '[]\n')
    assert.equal(alerts.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
