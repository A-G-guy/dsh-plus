import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { appendDisable, hasDisable, listDisabled, removeDisable } from '../src/patch-file.ts'

async function withPatchFile(initial: string, fn: (file: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'lifeboat-test-'))
  const file = join(dir, 'cordis.patch.yml')
  await writeFile(file, initial, 'utf-8')
  try {
    await fn(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('given entries with insert list, when checking nested disable, then finds it', () => {
  const entries = [{ insert: [{ id: 'dsh-plus-a' }, { id: 'dsh-plus-b', disabled: true }] }]
  assert.ok(hasDisable(entries, 'dsh-plus-b'))
  assert.ok(!hasDisable(entries, 'dsh-plus-a'))
})

test('given empty patch file, when appending disable, then entry added and backup created', async () => {
  await withPatchFile('[]\n', async (file) => {
    const written = await appendDisable(file, 'dsh-plus-x')
    assert.ok(written)
    const text = await readFile(file, 'utf-8')
    assert.match(text, /id: dsh-plus-x/)
    assert.match(text, /disabled: true/)
    const backup = await readFile(`${file}.lifeboat.bak`, 'utf-8')
    assert.equal(backup, '[]\n')
  })
})

test('given already disabled entry, when appending again, then skips without rewrite', async () => {
  const initial = '- id: dsh-plus-x\n  disabled: true\n'
  await withPatchFile(initial, async (file) => {
    const written = await appendDisable(file, 'dsh-plus-x')
    assert.ok(!written)
    assert.equal(await readFile(file, 'utf-8'), initial)
  })
})

test('given non-array patch file, when appending, then throws and leaves file intact', async () => {
  const initial = 'foo: bar\n'
  await withPatchFile(initial, async (file) => {
    await assert.rejects(() => appendDisable(file, 'dsh-plus-x'), /顶层不是数组/)
    assert.equal(await readFile(file, 'utf-8'), initial)
  })
})

test('removeDisable 移除既有禁用覆盖，保留其余条目与注释', async () => {
  await withPatchFile(
    `# 用户 patch：lifeboat 测试
- id: dsh-plus-demo
  disabled: true
- id: tool-subagent
  config:
    provider: spawn
`,
    async (file) => {
      const written = await removeDisable(file, 'dsh-plus-demo')
      assert.equal(written, true)
      const text = await readFile(file, 'utf-8')
      assert.ok(!text.includes('disabled'), '禁用覆盖应被移除')
      assert.ok(text.includes('tool-subagent'), '其余条目应保留')
      assert.ok(text.includes('# 用户 patch'), '注释应保留')
    },
  )
})

test('removeDisable 无覆盖时幂等返回 false', async () => {
  await withPatchFile('- id: other\n  disabled: true\n', async (file) => {
    const written = await removeDisable(file, 'dsh-plus-demo')
    assert.equal(written, false)
    const text = await readFile(file, 'utf-8')
    assert.ok(text.includes('other'), '无关条目不应被动')
  })
})

test('listDisabled 列出顶层已禁用 id（忽略 insert 子列表）', () => {
  const ids = listDisabled([
    { id: 'a', disabled: true },
    { id: 'b', disabled: false },
    { id: 'c' },
    { insert: [{ id: 'd', disabled: true }] },
  ])
  assert.deepEqual(ids, ['a'])
})
