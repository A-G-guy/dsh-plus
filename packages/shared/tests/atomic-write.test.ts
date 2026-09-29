/**
 * 原子写单测：内容写委托官方 writeFileAtomic（0o600 收窄、无残留临时文件），
 * commitTmpFile 的 rename→复制回退与双失败 errno 保留语义。
 * @module @dsh-plus/shared/tests/atomic-write
 */
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  type AtomicWriteIo,
  atomicWriteFile,
  commitTmpFile,
  PLUGIN_DATA_FILE_MODE,
} from '../src/atomic-write.ts'

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plus-atomic-'))
  try {
    await run(dir)
  } finally {
    // 仅清理本测试创建的临时目录（mkdtemp 前缀锁定，不会误伤共享 /tmp）。
    await rm(dir, { recursive: true, force: true })
  }
}

/** 收集 warn 输出并还原（断言回退留痕）。 */
async function captureWarn(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]): void => {
    lines.push(args.map(String).join(' '))
  }
  try {
    await run()
  } finally {
    console.warn = original
  }
  return lines
}

test('given existing target, when atomicWriteFile commits, then content is replaced with 0o600 and no temp remains', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'data.json')
    await writeFile(target, 'old', 'utf8')
    await atomicWriteFile(target, '{"ok":true}')
    assert.equal(await readFile(target, 'utf8'), '{"ok":true}')
    assert.equal((await stat(target)).mode & 0o777, PLUGIN_DATA_FILE_MODE)
    const leftovers = (await readdir(dir)).filter((name) => name !== 'data.json')
    assert.deepEqual(leftovers, [])
  })
})

test('given a missing parent dir, when atomicWriteFile commits, then parents are created', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'nested', 'deep', 'state.json')
    await atomicWriteFile(target, 'x')
    assert.equal(await readFile(target, 'utf8'), 'x')
  })
})

test('given tmp on disk, when commitTmpFile runs, then rename lands the content', async () => {
  await withTempDir(async (dir) => {
    const tmp = join(dir, 'state.json.tmp')
    const target = join(dir, 'state.json')
    await writeFile(tmp, 'payload', 'utf8')
    await commitTmpFile(tmp, target)
    assert.equal(await readFile(target, 'utf8'), 'payload')
  })
})

test('given rename EPERM, when commitTmpFile runs, then copy fallback lands content and warns once', async () => {
  await withTempDir(async (dir) => {
    const tmp = join(dir, 'state.json.tmp')
    const target = join(dir, 'state.json')
    await writeFile(tmp, 'payload', 'utf8')
    const renameError = Object.assign(new Error('EPERM: operation not permitted'), {
      code: 'EPERM',
    })
    const io: AtomicWriteIo = {
      rename: (() => Promise.reject(renameError)) as AtomicWriteIo['rename'],
      copyFile,
      rm,
    }
    const warnings = await captureWarn(() => commitTmpFile(tmp, target, io))
    assert.equal(await readFile(target, 'utf8'), 'payload')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /EPERM/)
  })
})

test('given rename and copy both fail, when commitTmpFile runs, then rename errno is preserved and both contexts are logged', async () => {
  await withTempDir(async (dir) => {
    const tmp = join(dir, 'state.json.tmp')
    const target = join(dir, 'state.json')
    await writeFile(tmp, 'payload', 'utf8')
    const renameError = Object.assign(new Error('rename EPERM'), { code: 'EPERM' })
    const copyError = Object.assign(new Error('copy EACCES'), { code: 'EACCES' })
    const io: AtomicWriteIo = {
      rename: (() => Promise.reject(renameError)) as AtomicWriteIo['rename'],
      copyFile: (() => Promise.reject(copyError)) as AtomicWriteIo['copyFile'],
      rm,
    }
    const warnings = await captureWarn(async () => {
      await assert.rejects(
        commitTmpFile(tmp, target, io),
        (error: unknown) => error === renameError,
      )
    })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /EPERM/)
    assert.match(warnings[0] ?? '', /EACCES/)
    assert.equal(await readFile(tmp, 'utf8'), 'payload')
  })
})
