import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { classifyPatchFile, syncManagedEntries } from '../src/patch-file.ts'

async function withPatchFile(initial: string, fn: (file: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'feature-toggle-test-'))
  const file = join(dir, 'cordis.patch.yml')
  await writeFile(file, initial, 'utf-8')
  try {
    await fn(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('given empty patch file, when syncing one disable, then managed entry with marker appended and backup created', async () => {
  await withPatchFile('[]\n', async (file) => {
    const written = await syncManagedEntries(file, new Set(['dsh-plus-notify-email']))
    assert.ok(written)
    const text = await readFile(file, 'utf-8')
    assert.match(text, /dsh-plus-feature-toggle:managed/)
    assert.match(text, /id: dsh-plus-notify-email/)
    assert.match(text, /disabled: true/)
    const backup = await readFile(`${file}.feature-toggle.bak`, 'utf-8')
    assert.equal(backup, '[]\n')
  })
})

test('given managed entry exists, when syncing same set again, then idempotent without rewrite', async () => {
  const initial = `# dsh-plus-feature-toggle:managed
- id: dsh-plus-notify-email
  disabled: true
`
  await withPatchFile(initial, async (file) => {
    const written = await syncManagedEntries(file, new Set(['dsh-plus-notify-email']))
    assert.ok(!written)
    assert.equal(await readFile(file, 'utf-8'), initial)
  })
})

test('given managed disable exists, when syncing empty set, then entry removed and backup keeps prior state', async () => {
  await withPatchFile(
    '# dsh-plus-feature-toggle:managed\n- id: dsh-plus-reload\n  disabled: true\n',
    async (file) => {
      const written = await syncManagedEntries(file, new Set())
      assert.ok(written)
      const text = await readFile(file, 'utf-8')
      assert.ok(!text.includes('dsh-plus-reload'))
      const backup = await readFile(`${file}.feature-toggle.bak`, 'utf-8')
      assert.match(backup, /dsh-plus-reload/)
    },
  )
})

test('given foreign entries (lifeboat style and manual), when syncing, then foreign entries untouched', async () => {
  const initial = `- id: dsh-plus-web-files
  disabled: true
# dsh-plus-feature-toggle:managed
- id: dsh-plus-reload
  disabled: true
- id: some-user-row
  config: {a: 1}
`
  await withPatchFile(initial, async (file) => {
    // 期望同时管理 web-files 与 reload：外部 web-files 条目保留，管理条目只管 reload
    await syncManagedEntries(file, new Set(['dsh-plus-web-files', 'dsh-plus-reload']))
    const text = await readFile(file, 'utf-8')
    assert.match(text, /- id: dsh-plus-web-files\n {2}disabled: true/)
    assert.match(text, /some-user-row/)
    const classified = await classifyPatchFile(file)
    // web-files 有外部条目；引擎层不会为它加管理条目（reconcile 测试覆盖），
    // 这里直接同步时也不应重复：分类应看到 web-files 为 external
    assert.equal(classified.external.filter((e) => e.id === 'dsh-plus-web-files').length, 1)
  })
})

test('given foreign disable for a row, when classifying, then external vs managed separated by marker', async () => {
  const initial = `- id: dsh-plus-web-files
  disabled: true
# dsh-plus-feature-toggle:managed
- id: dsh-plus-reload
  disabled: true
`
  await withPatchFile(initial, async (file) => {
    const classified = await classifyPatchFile(file)
    assert.equal(classified.external.length, 1)
    assert.equal(classified.external[0]?.id, 'dsh-plus-web-files')
    assert.equal(classified.managed.length, 1)
    assert.equal(classified.managed[0]?.id, 'dsh-plus-reload')
  })
})

test('given row outside catalog, when syncing, then rejected without touching file', async () => {
  const initial = '[]\n'
  await withPatchFile(initial, async (file) => {
    await assert.rejects(() => syncManagedEntries(file, new Set(['llm'])), /不在功能目录/)
    await assert.rejects(() => syncManagedEntries(file, new Set(['subagent'])), /不在功能目录/)
    assert.equal(await readFile(file, 'utf-8'), initial)
  })
})

test('given non-array patch file, when syncing, then throws and leaves file intact', async () => {
  const initial = 'foo: bar\n'
  await withPatchFile(initial, async (file) => {
    await assert.rejects(
      () => syncManagedEntries(file, new Set(['dsh-plus-reload'])),
      /顶层不是数组/,
    )
    assert.equal(await readFile(file, 'utf-8'), initial)
  })
})

test('given yaml comments elsewhere in file, when syncing, then comments preserved', async () => {
  const initial = `# Your patch layer for this dsh profile.
# Manual notes below.
[]
`
  await withPatchFile(initial, async (file) => {
    await syncManagedEntries(file, new Set(['dsh-plus-skill-manual']))
    const text = await readFile(file, 'utf-8')
    assert.match(text, /# Your patch layer for this dsh profile\./)
    assert.match(text, /# Manual notes below\./)
  })
})
