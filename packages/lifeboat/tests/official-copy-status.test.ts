/**
 * 应急副本状态读取行为：缺失/存在（mtime、route 数、头注释警告）/空补丁/
 * 不可解析/超限，全部降级为结构化状态，绝不抛出（面板与告警的输入）。
 * @module lifeboat/tests/official-copy-status
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type TestContext, test } from 'node:test'

import {
  OFFICIAL_COPY_FILE,
  parseCopyText,
  readOfficialCopyStatus,
} from '../src/official-copy-status.ts'

/** 夹具目录（测试结束自动清理）。 */
function fixtureDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'lifeboat-copy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 最小可解析副本：一条警告头 + 禁用行 + llm-pi-ai 行。 */
const VALID_COPY = `# 官方应急 LLM 副本
# 警告：deepseek route "chatds" 的字段未迁移到 llm-pi-ai：thinking
- id: dsh-plus-llm-pi
  disabled: true
- id: llm-pi-ai
  config:
    providers:
      chat:
        api: openai-completions
      gateway:
        api: openai-completions
`

test('given no file, when reading, then exists false with no throw', async (t) => {
  const dir = fixtureDir(t)
  const status = await readOfficialCopyStatus(join(dir, 'absent.yaml'))
  assert.deepEqual(status, { path: join(dir, 'absent.yaml'), exists: false, warnings: [] })
})

test('given a valid copy, when reading, then mtime, route count and header warnings surface', async (t) => {
  const dir = fixtureDir(t)
  const path = join(dir, OFFICIAL_COPY_FILE)
  writeFileSync(path, VALID_COPY)
  const status = await readOfficialCopyStatus(path)
  assert.equal(status.exists, true)
  assert.equal(typeof status.updatedAt, 'number')
  assert.equal(status.routes, 2)
  assert.deepEqual(status.warnings, ['deepseek route "chatds" 的字段未迁移到 llm-pi-ai：thinking'])
  assert.equal(status.detail, undefined)
})

test('given an empty patch list, when reading, then routes is zero (applying would be a no-op)', async (t) => {
  const dir = fixtureDir(t)
  const path = join(dir, 'empty.yaml')
  writeFileSync(path, '# 空补丁\n[]\n')
  const status = await readOfficialCopyStatus(path)
  assert.equal(status.exists, true)
  assert.equal(status.routes, 0)
  assert.deepEqual(status.warnings, [])
})

test('given unparseable or malformed content, when reading, then detail explains instead of throwing', async (t) => {
  const dir = fixtureDir(t)
  const broken = join(dir, 'broken.yaml')
  writeFileSync(broken, 'not: [valid\n')
  const brokenStatus = await readOfficialCopyStatus(broken)
  assert.equal(brokenStatus.exists, true)
  assert.ok(brokenStatus.detail?.includes('解析失败'))

  const notAList = join(dir, 'mapping.yaml')
  writeFileSync(notAList, 'providers:\n  chat: {}\n')
  const mapStatus = await readOfficialCopyStatus(notAList)
  assert.equal(mapStatus.detail, '内容不是 patch 列表')
})

test('given an oversized file, when reading, then content stays unread', async (t) => {
  const dir = fixtureDir(t)
  const path = join(dir, 'huge.yaml')
  writeFileSync(path, Buffer.alloc(2 * 1024 * 1024 + 1, 0x20))
  const status = await readOfficialCopyStatus(path)
  assert.equal(status.exists, true)
  assert.equal(status.detail, '文件超出解析上限，未读取内容')
  assert.equal(status.routes, undefined)
})

test('parseCopyText: a disable-only copy reports the missing llm-pi-ai row', () => {
  const parsed = parseCopyText('- id: dsh-plus-llm-pi\n  disabled: true\n')
  assert.equal(parsed.routes, undefined)
  assert.ok(parsed.detail?.includes('缺 llm-pi-ai'))
})
