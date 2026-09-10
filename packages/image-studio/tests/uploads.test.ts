/**
 * 上传暂存区存储：落盘 + 索引、字节读取、孤儿回收（TTL + 引用保留）。
 * 存储落点 $DSH_HOME/dsh-plus/image-studio/uploads（测试用临时 DSH_HOME 隔离）。
 * 验收条件：被画廊条目引用的上传永不回收；未被引用且超期的回收；
 * 未超期的一次上传（正在编辑、任务排队中）不能被回收。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { UPLOAD_MAX_BYTES } from '../src/limits.ts'
import { loadUploads, pruneUploads, readUploadBytes, saveUpload } from '../src/uploads/store.ts'

const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

function useTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'image-studio-uploads-'))
  process.env.DSH_HOME = home
  return home
}

const quiet = (): void => {}

test('上传落盘：索引记录元数据，字节可按 id 读回', async () => {
  const home = useTempHome()
  try {
    const entry = await saveUpload({ name: '照片.png', mime: 'image/png', data: PNG_1PX })
    assert.match(entry.id, /^[0-9a-f-]{36}$/)
    assert.equal(entry.name, '照片.png')
    assert.equal(entry.ext, 'png')
    assert.equal(entry.size, PNG_1PX.byteLength)
    const list = await loadUploads(quiet)
    assert.equal(list.length, 1)
    assert.deepEqual(list[0], entry)
    const bytes = await readUploadBytes(entry.id)
    assert.equal(bytes.ext, 'png')
    assert.deepEqual([...bytes.data], [...PNG_1PX])
    // 文件名不参与路径：落盘目录只按 uuid 命名。
    const files = await readdir(join(home, 'dsh-plus/image-studio/uploads/blobs'))
    assert.deepEqual(files, [`${entry.id}.png`])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('未知上传标识抛错（端点据此映射 404）', async () => {
  const home = useTempHome()
  try {
    await assert.rejects(
      () => readUploadBytes('3f2504e0-4f89-11d3-9a0c-0305e82c3301'),
      /unknown-upload/,
    )
    await assert.rejects(() => readUploadBytes('../../etc/passwd'), /unknown-upload/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('回收：被引用的保留、超期未引用的删除、未超期的不动', async () => {
  const home = useTempHome()
  try {
    const kept = await saveUpload({ name: 'referenced.png', mime: 'image/png', data: PNG_1PX })
    const stale = await saveUpload({ name: 'stale.png', mime: 'image/png', data: PNG_1PX })
    const ttlMs = 24 * 3_600_000
    const t0 = Date.parse(stale.createdAt)

    // 未超期：一条都不动（正在编辑/uploads 刚落地）。
    const early = await pruneUploads({ keepIds: new Set(), ttlMs, now: t0 + 1000, log: quiet })
    assert.equal(early, 0)

    // 超期后：被引用的 kept 保留，未被引用的 stale 回收。
    const removed = await pruneUploads({
      keepIds: new Set([kept.id]),
      ttlMs,
      now: t0 + ttlMs + 1000,
      log: quiet,
    })
    assert.equal(removed, 1, '仅删除超期且未被引用的一条')
    const left = await loadUploads(quiet)
    assert.deepEqual(
      left.map((item) => item.name),
      ['referenced.png'],
    )
    const files = await readdir(join(home, 'dsh-plus/image-studio/uploads/blobs'))
    assert.equal(files.length, 1, '字节文件随索引一起回收')
    assert.deepEqual(files, [`${kept.id}.png`])
    assert.ok(!files.some((name) => name.startsWith(stale.id)))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('回收阈值：刚上传的条目在 TTL 内不被回收（任务排队中仍可用）', async () => {
  const home = useTempHome()
  try {
    const entry = await saveUpload({ name: 'in-flight.png', mime: 'image/png', data: PNG_1PX })
    const removed = await pruneUploads({
      keepIds: new Set(),
      ttlMs: 24 * 3_600_000,
      now: Date.parse(entry.createdAt) + 60_000,
      log: quiet,
    })
    assert.equal(removed, 0)
    assert.equal((await loadUploads(quiet)).length, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('上传上限与官方口径一致（50MB）', () => {
  assert.equal(UPLOAD_MAX_BYTES, 50 * 1024 * 1024)
})
