/**
 * 预算目录锁的行为测试：与官方 CLI 的路径/协议一致、独占互斥、共享共存、
 * 超时显式报错、陈旧门闩可回收。
 * @module @dsh-plus/actual-reports/tests/lock
 */

import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { acquireBudgetLock, metaDirOf } from '../src/lock.ts'
import { createNodeIo, nodeFs } from '../src/node-io.ts'

const SYNC_ID = 'sync-test'

/** 造一个临时 dataDir。 */
async function tempDataDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dsh-reports-lock-'))
}

test('门闩与读者标记落在官方约定的路径上', async () => {
  const dataDir = await tempDataDir()
  const io = createNodeIo()
  try {
    const release = await acquireBudgetLock(
      dataDir,
      SYNC_ID,
      { mode: 'shared', timeoutMs: 1_000 },
      io,
    )
    const meta = metaDirOf(dataDir, SYNC_ID)
    const readers = await readdir(join(meta, 'readers'))
    assert.equal(readers.length, 1)
    assert.match(readers[0] ?? '', new RegExp(`^${process.pid}-`))
    await release()
    assert.deepEqual(await readdir(join(meta, 'readers')), [])
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('独占锁在另一个进程持锁时超时并给出指引', async () => {
  const dataDir = await tempDataDir()
  const io = createNodeIo()
  try {
    const meta = metaDirOf(dataDir, SYNC_ID)
    await nodeFs.mkdirp(join(meta, 'lock')) // 模拟另一个进程正持门闩
    await assert.rejects(
      async () =>
        await acquireBudgetLock(dataDir, SYNC_ID, { mode: 'exclusive', timeoutMs: 300 }, io),
      /预算目录被另一个进程占用（已等待 0s）/,
    )
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('陈旧门闩（mtime 超过 30s）被回收后加锁成功', async () => {
  const dataDir = await tempDataDir()
  const io = createNodeIo()
  try {
    const gate = join(metaDirOf(dataDir, SYNC_ID), 'lock')
    await nodeFs.mkdirp(gate)
    const past = new Date(Date.now() - 60_000)
    await utimes(gate, past, past)
    const release = await acquireBudgetLock(
      dataDir,
      SYNC_ID,
      { mode: 'exclusive', timeoutMs: 1_000 },
      io,
    )
    await release()
    assert.equal(await nodeFs.exists(gate), false)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('独占锁等待读者清空：存活 pid 的标记不会被清掉', async () => {
  const dataDir = await tempDataDir()
  const io = createNodeIo()
  try {
    const readers = join(metaDirOf(dataDir, SYNC_ID), 'readers')
    await nodeFs.mkdirp(readers)
    await nodeFs.writeTextAtomic(join(readers, `${process.pid}-alive`), '')
    await assert.rejects(
      async () =>
        await acquireBudgetLock(dataDir, SYNC_ID, { mode: 'exclusive', timeoutMs: 300 }, io),
      /预算目录被另一个进程占用/,
    )
    // 死 pid 的残留标记会被清扫，加锁随即成功。
    await nodeFs.writeTextAtomic(join(readers, '999999-dead'), '')
    await nodeFs.remove(join(readers, `${process.pid}-alive`))
    const release = await acquireBudgetLock(
      dataDir,
      SYNC_ID,
      { mode: 'exclusive', timeoutMs: 1_000 },
      io,
    )
    await release()
    assert.deepEqual(await readdir(readers), [])
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
