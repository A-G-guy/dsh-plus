import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  appendDisable,
  hasDisable,
  listDisabled,
  removeDisable,
  salvageDisabled,
} from '../src/patch-file.ts'

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

// ── 2026-08-30 事故回归：保险丝自身的两个失败签名 ─────────────────

test('given 并发隔离多插件（共享 patch 文件），when 同时 append，then 全部落盘无 ENOENT', async () => {
  // 事故签名：多插件同一毫秒 FAILED → 共享固定 tmp 名 → rename ENOENT / 丢更新。
  // 修复后按文件串行化 + 唯一 tmp 名，全部条目必须落盘。
  await withPatchFile('[]\n', async (file) => {
    const names = ['dsh-plus-a', 'dsh-plus-b', 'dsh-plus-c', 'dsh-plus-d']
    const results = await Promise.all(names.map((name) => appendDisable(file, name)))
    assert.deepEqual(results, [true, true, true, true])
    const text = await readFile(file, 'utf-8')
    for (const name of names) assert.ok(text.includes(name), `${name} 应落盘`)
  })
})

test('given YAML 语法已坏的 patch 文件，when append，then 走重建通道且打捞既有禁用', async () => {
  // 事故签名：doc.errors 非空仍 toString → "Document with errors cannot be
  // stringified"，隔离永远写不进去。重建必须保留既有禁用（漏掉 = 重新放行故障插件）。
  const broken = '- id: dsh-plus-old\n  disabled: true\n- id: broken\n  config: [unclosed\n'
  await withPatchFile(broken, async (file) => {
    const written = await appendDisable(file, 'dsh-plus-new')
    assert.ok(written)
    const text = await readFile(file, 'utf-8')
    assert.ok(text.includes('dsh-plus-new'), '新禁用条目落盘')
    assert.ok(text.includes('dsh-plus-old'), '既有禁用被打捞保留')
    // 重建产物必须是合法 YAML 且可被再次正常改写
    const again = await appendDisable(file, 'dsh-plus-after-rebuild')
    assert.ok(again, '重建后的文件应恢复可正常写入')
    // 原件现场备份存在
    const { readdir } = await import('node:fs/promises')
    const dir = join(file, '..')
    const files = await readdir(dir)
    assert.ok(
      files.some((name) => name.includes('.broken-')),
      '坏文件应有备份',
    )
  })
})

test('given YAML 已坏且目标已在打捞集，when append，then 幂等返回 false 但文件被修复', async () => {
  const broken = '- id: dsh-plus-x\n  disabled: true\n  bad: [unclosed\n'
  await withPatchFile(broken, async (file) => {
    const written = await appendDisable(file, 'dsh-plus-x')
    assert.ok(!written, '禁用已存在（打捞命中）→ 目标集合未变')
    // 坏文件对 loader 等于不存在：即使幂等也必须修复成合法 YAML
    const repaired = await readFile(file, 'utf-8')
    assert.ok(!repaired.includes('unclosed'), '坏内容应被重建覆盖')
    const after = await appendDisable(file, 'dsh-plus-y')
    assert.ok(after, '修复后的文件应恢复可正常写入')
  })
})

test('removeDisable 遇 YAML 语法错误时抛错指引人工处理', async () => {
  const broken = '- id: dsh-plus-x\n  disabled: true\n  bad: [unclosed\n'
  await withPatchFile(broken, async (file) => {
    await assert.rejects(() => removeDisable(file, 'dsh-plus-x'), /YAML 语法错误/)
  })
})

test('salvageDisabled 只打捞同条块内 disabled:true 的 id', () => {
  const text = `- id: dsh-plus-a
  disabled: true
- id: dsh-plus-b
  config:
    x: 1
- id: dsh-plus-c
  disabled: false
`
  assert.deepEqual(salvageDisabled(text), ['dsh-plus-a'])
})
