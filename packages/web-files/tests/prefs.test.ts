/**
 * PrefsStore 偏好存储单测：sanitize 容错、补丁合并、上限逐出、原子落盘自愈。
 * @module @dsh-plus/web-files/tests/prefs
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { FilesError } from '../src/fs-core.ts'
import { defaultPrefs, PrefsStore, requirePrefsPatch, sanitizePrefs } from '../src/prefs.ts'
import { PREFS_SORT_MAX_DIRS } from '../src/protocol.ts'

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-web-files-prefs-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('given no prefs file, when reading, then defaults are returned', async () => {
  await withTempDir(async (dir) => {
    const store = new PrefsStore(join(dir, 'prefs.json'))
    assert.deepEqual(await store.read(), defaultPrefs())
  })
})

test('given a corrupt prefs file, when reading, then defaults are returned and patch self-heals', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'prefs.json')
    await writeFile(path, '{not json', 'utf8')
    const store = new PrefsStore(path)
    assert.deepEqual(await store.read(), defaultPrefs())
    const patched = await store.patch({ showHidden: true })
    assert.equal(patched.showHidden, true)
    assert.equal((await store.read()).showHidden, true)
  })
})

test('given dirty persisted data, when sanitizing, then invalid entries are dropped', () => {
  const prefs = sanitizePrefs({
    showHidden: 'yes',
    sortByDir: {
      '/ok': { key: 'size', dir: 'desc' },
      'relative/path': { key: 'name', dir: 'asc' },
      '/bad-key': { key: 'color', dir: 'asc' },
      '/bad-dir': { key: 'name', dir: 'sideways' },
      '/not-object': 42,
    },
    extra: 'ignored',
  })
  assert.equal(prefs.showHidden, false)
  assert.deepEqual(prefs.sortByDir, { '/ok': { key: 'size', dir: 'desc' } })
})

test('given sort patches for two dirs, when patching, then each dir remembers its own sort', async () => {
  await withTempDir(async (dir) => {
    const store = new PrefsStore(join(dir, 'prefs.json'))
    await store.patch({ sortFor: { path: '/a', value: { key: 'mtime', dir: 'desc' } } })
    const prefs = await store.patch({
      sortFor: { path: '/b', value: { key: 'size', dir: 'asc' } },
    })
    assert.deepEqual(prefs.sortByDir, {
      '/a': { key: 'mtime', dir: 'desc' },
      '/b': { key: 'size', dir: 'asc' },
    })
    // 另一进程等价物：新实例从磁盘读到完全一致的状态（跨设备共享同一文件）
    const fresh = new PrefsStore(join(dir, 'prefs.json'))
    assert.deepEqual((await fresh.read()).sortByDir, prefs.sortByDir)
  })
})

test('given a remembered dir, when patching it again, then it becomes the most recent entry', async () => {
  await withTempDir(async (dir) => {
    const store = new PrefsStore(join(dir, 'prefs.json'))
    await store.patch({ sortFor: { path: '/a', value: { key: 'name', dir: 'asc' } } })
    await store.patch({ sortFor: { path: '/b', value: { key: 'name', dir: 'asc' } } })
    const prefs = await store.patch({
      sortFor: { path: '/a', value: { key: 'size', dir: 'desc' } },
    })
    assert.deepEqual(Object.keys(prefs.sortByDir), ['/b', '/a'])
    assert.deepEqual(prefs.sortByDir['/a'], { key: 'size', dir: 'desc' })
  })
})

test('given more dirs than the cap, when sanitizing, then oldest entries are evicted', () => {
  const sortByDir: Record<string, { key: 'name'; dir: 'asc' }> = {}
  for (let index = 0; index < PREFS_SORT_MAX_DIRS + 10; index += 1) {
    sortByDir[`/dir-${String(index)}`] = { key: 'name', dir: 'asc' }
  }
  const prefs = sanitizePrefs({ showHidden: false, sortByDir })
  const keys = Object.keys(prefs.sortByDir)
  assert.equal(keys.length, PREFS_SORT_MAX_DIRS)
  assert.equal(keys.includes('/dir-0'), false)
  assert.equal(keys.includes(`/dir-${String(PREFS_SORT_MAX_DIRS + 9)}`), true)
})

test('given concurrent patches, when patching, then none is lost', async () => {
  await withTempDir(async (dir) => {
    const store = new PrefsStore(join(dir, 'prefs.json'))
    await Promise.all([
      store.patch({ showHidden: true }),
      store.patch({ sortFor: { path: '/x', value: { key: 'mtime', dir: 'asc' } } }),
    ])
    const prefs = await store.read()
    assert.equal(prefs.showHidden, true)
    assert.deepEqual(prefs.sortByDir, { '/x': { key: 'mtime', dir: 'asc' } })
  })
})

test('given an invalid patch, when validating, then a FilesError is raised', () => {
  assert.throws(() => requirePrefsPatch({ showHidden: 'yes' }), FilesError)
  assert.throws(
    () => requirePrefsPatch({ sortFor: { path: 'relative', value: { key: 'name', dir: 'asc' } } }),
    FilesError,
  )
  assert.throws(
    () => requirePrefsPatch({ sortFor: { path: '/ok', value: { key: 'color', dir: 'asc' } } }),
    FilesError,
  )
})

test('given a valid patch, when validating, then it passes through normalized', () => {
  const patch = requirePrefsPatch({
    showHidden: true,
    sortFor: { path: '/a', value: { key: 'size', dir: 'desc' } },
  })
  assert.deepEqual(patch, {
    showHidden: true,
    sortFor: { path: '/a', value: { key: 'size', dir: 'desc' } },
  })
})

test('given a patched store, when the file lands, then it is valid formatted JSON', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'nested', 'prefs.json')
    const store = new PrefsStore(path)
    await store.patch({ showHidden: true })
    const raw = await readFile(path, 'utf8')
    assert.deepEqual(JSON.parse(raw), { showHidden: true, sortByDir: {} })
  })
})
