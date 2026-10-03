import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createPendingRestart } from '../src/pending.ts'

interface Profile {
  dir: string
  artifact: string
  dispose: () => void
}

/** 临时 profile：package.json 声明一个依赖，依赖内有一个构建产物文件。 */
function makeProfile(dependencies: Record<string, string> = { '@dsh-plus/demo': 'file:demo.tgz' }) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-reload-pending-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies }), 'utf-8')
  const pkgDir = join(dir, 'node_modules', '@dsh-plus', 'demo')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), '{"version":"1.0.0"}', 'utf-8')
  const artifact = join(pkgDir, 'lib', 'index.js')
  writeFileSync(artifact, 'export const v = 1', 'utf-8')
  const profile: Profile = {
    dir,
    artifact,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
  return profile
}

test('given an untouched profile, when checked, then nothing is pending', async () => {
  const profile = makeProfile()
  try {
    const pending = createPendingRestart({
      binName: 'dsh',
      profileDir: profile.dir,
      enabled: true,
      onError: () => {},
    })
    assert.deepEqual(await pending.changed(), [])
  } finally {
    profile.dispose()
  }
})

test('given a replaced artifact after the baseline, when checked, then the package is pending', async () => {
  const profile = makeProfile()
  try {
    const pending = createPendingRestart({
      binName: 'dsh',
      profileDir: profile.dir,
      enabled: true,
      onError: () => {},
    })
    // 基线在构造时异步发起；先让首次比对完成，再替换产物。
    assert.deepEqual(await pending.changed(), [])
    writeFileSync(profile.artifact, 'export const v = 2', 'utf-8')
    assert.deepEqual(await pending.changed(), ['@dsh-plus/demo'])
    // 基线不随后续比对推进：同一变更重复报告。
    assert.deepEqual(await pending.changed(), ['@dsh-plus/demo'])
  } finally {
    profile.dispose()
  }
})

test('given the switch off, when checked, then nothing is pending', async () => {
  const profile = makeProfile()
  try {
    const pending = createPendingRestart({
      binName: 'dsh',
      profileDir: profile.dir,
      enabled: false,
      onError: () => {},
    })
    writeFileSync(profile.artifact, 'export const v = 2', 'utf-8')
    assert.deepEqual(await pending.changed(), [])
  } finally {
    profile.dispose()
  }
})

test('given no profile dir, when checked, then nothing is pending', async () => {
  const pending = createPendingRestart({
    binName: 'dsh',
    profileDir: undefined,
    enabled: true,
    onError: () => {},
  })
  assert.deepEqual(await pending.changed(), [])
})

test('given an unreadable manifest, when checked, then it degrades to empty with one diagnostic', async () => {
  const errors: string[] = []
  const pending = createPendingRestart({
    binName: 'dsh',
    profileDir: join(tmpdir(), 'dsh-reload-missing-profile'),
    enabled: true,
    onError: (message) => errors.push(message),
  })
  assert.deepEqual(await pending.changed(), [])
  assert.equal(errors.length, 1)
  assert.match(errors[0] ?? '', /产物指纹基线采集失败/)
})

test('given a profile without dependencies, when checked, then nothing is pending', async () => {
  const profile = makeProfile({})
  try {
    const pending = createPendingRestart({
      binName: 'dsh',
      profileDir: profile.dir,
      enabled: true,
      onError: () => {},
    })
    assert.deepEqual(await pending.changed(), [])
  } finally {
    profile.dispose()
  }
})
