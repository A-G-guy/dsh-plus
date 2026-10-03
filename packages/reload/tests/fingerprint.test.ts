import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type ArtifactPort, captureFingerprints, diffFingerprints } from '../src/fingerprint.ts'

/** 内存文件系统：键为绝对路径，目录由文件路径推导（测试零磁盘依赖）。 */
function memoryPort(files: Record<string, string>): ArtifactPort {
  const dirs = new Map<string, Set<string>>()
  for (const path of Object.keys(files)) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      const child = parts[index]
      if (child === undefined) continue
      const dir = parts.slice(0, index).join('/')
      const children = dirs.get(dir) ?? new Set<string>()
      children.add(child)
      dirs.set(dir, children)
    }
  }
  return {
    read(path) {
      const children = dirs.get(path)
      if (children !== undefined) {
        return Promise.resolve({ kind: 'dir', children: [...children] })
      }
      const content = files[path]
      if (content === undefined) return Promise.resolve(undefined)
      return Promise.resolve({ kind: 'file', bytes: new TextEncoder().encode(content) })
    },
  }
}

const PROFILE = '/home/u/.dsh/profiles/web'
const RELOAD_INDEX = `${PROFILE}/node_modules/@dsh-plus/reload/lib/index.js`

function baseFiles(): Record<string, string> {
  return {
    [`${PROFILE}/node_modules/@dsh-plus/reload/package.json`]: '{"version":"0.2.0"}',
    [RELOAD_INDEX]: 'export const name = "dsh-plus-reload"',
    [`${PROFILE}/node_modules/@dsh-plus/reload/lib/client.js`]: 'client-v1',
  }
}

test('given same content, when captured twice, then fingerprints are identical', async () => {
  const port = memoryPort(baseFiles())
  const before = await captureFingerprints(PROFILE, ['@dsh-plus/reload'], port)
  const after = await captureFingerprints(PROFILE, ['@dsh-plus/reload'], port)
  assert.deepEqual(diffFingerprints(before, after), [])
  assert.equal(before['@dsh-plus/reload']?.files, 3)
})

test('given a replaced build artifact, when compared, then the package is reported', async () => {
  const before = await captureFingerprints(PROFILE, ['@dsh-plus/reload'], memoryPort(baseFiles()))
  const files = baseFiles()
  files[RELOAD_INDEX] = 'export const name = "dsh-plus-reload-v2"'
  const after = await captureFingerprints(PROFILE, ['@dsh-plus/reload'], memoryPort(files))
  assert.deepEqual(diffFingerprints(before, after), ['@dsh-plus/reload'])
})

test('given a changed package.json only, when compared, then the package is reported', async () => {
  const before = await captureFingerprints(PROFILE, ['@dsh-plus/reload'], memoryPort(baseFiles()))
  const files = baseFiles()
  files[`${PROFILE}/node_modules/@dsh-plus/reload/package.json`] = '{"version":"0.3.0"}'
  const after = await captureFingerprints(PROFILE, ['@dsh-plus/reload'], memoryPort(files))
  assert.deepEqual(diffFingerprints(before, after), ['@dsh-plus/reload'])
})

test('given an added and a removed package, when compared, then both are reported', async () => {
  const before = await captureFingerprints(
    PROFILE,
    ['@dsh-plus/reload', '@dsh-plus/gone'],
    memoryPort(baseFiles()),
  )
  const files = baseFiles()
  files[`${PROFILE}/node_modules/@dsh-plus/added/lib/index.js`] = 'new'
  const after = await captureFingerprints(
    PROFILE,
    ['@dsh-plus/reload', '@dsh-plus/added'],
    memoryPort(files),
  )
  assert.deepEqual(diffFingerprints(before, after), ['@dsh-plus/added', '@dsh-plus/gone'])
})

test('given dist and dotfile entries, when captured, then dist counts and dotfiles do not', async () => {
  const files = baseFiles()
  files[`${PROFILE}/node_modules/@dsh-plus/reload/dist/bundle.js`] = 'dist'
  files[`${PROFILE}/node_modules/@dsh-plus/reload/lib/.hidden`] = 'dot'
  files[`${PROFILE}/node_modules/@dsh-plus/reload/lib/node_modules/dep/index.js`] = 'nested'
  files[`${PROFILE}/node_modules/@dsh-plus/reload/lib/notes.txt`] = 'text'
  const fingerprints = await captureFingerprints(PROFILE, ['@dsh-plus/reload'], memoryPort(files))
  // package.json + index.js + client.js + dist/bundle.js + lib/notes.txt
  assert.equal(fingerprints['@dsh-plus/reload']?.files, 5)
})

test('given an uninstalled package, when captured, then the empty fingerprint is stable', async () => {
  const port = memoryPort(baseFiles())
  const first = await captureFingerprints(PROFILE, ['@dsh-plus/missing'], port)
  const second = await captureFingerprints(PROFILE, ['@dsh-plus/missing'], port)
  assert.equal(first['@dsh-plus/missing']?.files, 0)
  assert.deepEqual(diffFingerprints(first, second), [])
})
