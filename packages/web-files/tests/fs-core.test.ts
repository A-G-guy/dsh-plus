import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  buildCrumbs,
  createFile,
  deleteEntry,
  FilesError,
  listDirectory,
  makeDirectory,
  readFileText,
  renameEntry,
  statEntry,
  writeFileText,
} from '../src/fs-core.ts'
import { LIST_MAX_ENTRIES, READ_MAX_BYTES, READ_TRUNCATE_BYTES } from '../src/protocol.ts'

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-web-files-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('given a directory with dirs files and hidden entries, when listing without showHidden, then dirs sort first and hidden entries are absent', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'zdir'))
    await mkdir(join(dir, 'adir'))
    await writeFile(join(dir, 'b.txt'), 'b')
    await writeFile(join(dir, '.secret'), 's')
    const listing = await listDirectory(dir, false)
    assert.deepEqual(
      listing.entries.map((entry) => entry.name),
      ['adir', 'zdir', 'b.txt'],
    )
    assert.equal(listing.truncated, false)
    assert.equal(listing.path, dir)
    assert.ok(listing.crumbs.length > 1)
  })
})

test('given hidden entries, when listing with showHidden, then they appear with the hidden flag', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, '.secret'), 's')
    const listing = await listDirectory(dir, true)
    assert.equal(listing.entries.length, 1)
    assert.equal(listing.entries[0]?.hidden, true)
  })
})

test('given a relative path, when listing, then path-invalid is raised', async () => {
  await assert.rejects(listDirectory('relative/path', false), (error: unknown) => {
    assert.ok(error instanceof FilesError)
    assert.equal(error.code, 'path-invalid')
    return true
  })
})

test('given a missing directory, when listing, then not-found is raised with status 404', async () => {
  await assert.rejects(
    listDirectory('/nonexistent/dsh-web-files/nope', false),
    (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'not-found')
      assert.equal(error.status, 404)
      return true
    },
  )
})

test('given a binary file with NUL bytes, when reading, then binary-file is raised', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'bin.dat')
    await writeFile(path, Buffer.from([0x41, 0x00, 0x42]))
    await assert.rejects(readFileText(path), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'binary-file')
      assert.equal(error.status, 415)
      return true
    })
  })
})

test('given a non-UTF-8 file, when reading, then non-utf8 is raised', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'gbk.txt')
    await writeFile(path, Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))
    await assert.rejects(readFileText(path), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'non-utf8')
      return true
    })
  })
})

test('given an oversized text file, when reading, then content is truncated and flagged', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'big.txt')
    await writeFile(path, 'x'.repeat(READ_MAX_BYTES + 10))
    const result = await readFileText(path)
    assert.equal(result.truncated, true)
    assert.equal(result.content.length, READ_TRUNCATE_BYTES)
    assert.equal(result.size, READ_MAX_BYTES + 10)
  })
})

test('given a utf-8 file, when writing with the matching base mtime, then content is replaced and new mtime returned', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'a.txt')
    await writeFile(path, '旧内容')
    const before = await readFileText(path)
    const result = await writeFileText(path, '新内容', before.mtimeMs)
    assert.equal(await readFile(path, 'utf8'), '新内容')
    assert.ok(result.mtimeMs > 0)
  })
})

test('given a file changed on disk after read, when writing with a stale base mtime, then mtime-conflict is raised with status 409', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'v1')
    const before = await readFileText(path)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(path, 'v2-external')
    await assert.rejects(writeFileText(path, 'v3', before.mtimeMs), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'mtime-conflict')
      assert.equal(error.status, 409)
      return true
    })
    assert.equal(await readFile(path, 'utf8'), 'v2-external')
  })
})

test('given no base mtime, when writing, then the write goes through (force overwrite)', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'v1')
    await writeFileText(path, 'forced')
    assert.equal(await readFile(path, 'utf8'), 'forced')
  })
})

test('given an existing directory, when mkdir with the same name, then entry-exists is raised', async () => {
  await withTempDir(async (dir) => {
    await makeDirectory(dir, 'sub')
    await assert.rejects(makeDirectory(dir, 'sub'), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'entry-exists')
      return true
    })
  })
})

test('given a name with a separator, when mkdir, then name-invalid is raised', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(makeDirectory(dir, 'a/b'), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'name-invalid')
      return true
    })
  })
})

test('given an existing target name, when renaming, then entry-exists is raised', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'a.txt'), 'a')
    await writeFile(join(dir, 'b.txt'), 'b')
    await assert.rejects(renameEntry(join(dir, 'a.txt'), 'b.txt'), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'entry-exists')
      return true
    })
  })
})

test('given a non-empty directory, when deleting, then dir-not-empty is raised and content survives', async () => {
  await withTempDir(async (dir) => {
    const sub = join(dir, 'sub')
    await mkdir(sub)
    await writeFile(join(sub, 'keep.txt'), 'keep')
    await assert.rejects(deleteEntry(sub), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'dir-not-empty')
      return true
    })
    assert.equal(await readFile(join(sub, 'keep.txt'), 'utf8'), 'keep')
  })
})

test('given a file and an empty directory, when deleting, then both are removed', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'a.txt')
    const sub = join(dir, 'empty')
    await writeFile(file, 'a')
    await mkdir(sub)
    await deleteEntry(file)
    await deleteEntry(sub)
    const listing = await listDirectory(dir, true)
    assert.equal(listing.entries.length, 0)
  })
})

test('given a symlink to a directory, when listing, then it is classified as dir', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'real'))
    await symlink(join(dir, 'real'), join(dir, 'link'))
    const listing = await listDirectory(dir, false)
    const link = listing.entries.find((entry) => entry.name === 'link')
    assert.equal(link?.kind, 'dir')
  })
})

test('given more entries than the cap, when listing, then truncated is set', async () => {
  await withTempDir(async (dir) => {
    for (let index = 0; index < LIST_MAX_ENTRIES + 5; index += 1) {
      await writeFile(join(dir, `f${String(index).padStart(5, '0')}.txt`), 'x')
    }
    const listing = await listDirectory(dir, false)
    assert.equal(listing.entries.length, LIST_MAX_ENTRIES)
    assert.equal(listing.truncated, true)
  })
})

test('buildCrumbs yields root-first jump targets', () => {
  const crumbs = buildCrumbs('/home/user/proj')
  assert.deepEqual(crumbs, [
    { name: '/', path: '/' },
    { name: 'home', path: '/home' },
    { name: 'user', path: '/home/user' },
    { name: 'proj', path: '/home/user/proj' },
  ])
})

test('given an empty parent, when creating a file, then an empty regular file is returned and readable', async () => {
  await withTempDir(async (dir) => {
    const result = await createFile(dir, 'note.md')
    assert.equal(result.kind, 'file')
    assert.equal(result.name, 'note.md')
    assert.equal(result.size, 0)
    assert.equal(await readFile(join(dir, 'note.md'), 'utf8'), '')
    const read = await readFileText(join(dir, 'note.md'))
    assert.equal(read.content, '')
  })
})

test('given an existing entry, when creating a file with the same name, then entry-exists is raised', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'a.txt'), 'a')
    await assert.rejects(createFile(dir, 'a.txt'), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'entry-exists')
      return true
    })
  })
})

test('given a path, when statting, then kind and metadata match the entry', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'f.txt'), 'hello')
    const dirEntry = await statEntry(join(dir, 'sub'))
    assert.equal(dirEntry.kind, 'dir')
    assert.equal(dirEntry.name, 'sub')
    const fileEntry = await statEntry(join(dir, 'f.txt'))
    assert.equal(fileEntry.kind, 'file')
    assert.equal(fileEntry.size, 5)
    assert.equal(fileEntry.name, 'f.txt')
  })
})

test('given a missing path, when statting, then not-found is raised', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(statEntry(join(dir, 'nope')), (error: unknown) => {
      assert.ok(error instanceof FilesError)
      assert.equal(error.code, 'not-found')
      return true
    })
  })
})
