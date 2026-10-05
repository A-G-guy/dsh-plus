/**
 * api 入口定位的行为测试：显式路径 → 官方 CLI 入口 → PATH 兜底的优先级与显式报错。
 * @module @dsh-plus/actual-reports/tests/api-path
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveApiPath } from '../src/api.ts'
import type { ReportsConfig } from '../src/env.ts'
import type { ReportsIo } from '../src/node-io.ts'

/** 基准配置（只有定位相关字段有意义）。 */
function configOf(overrides: Partial<ReportsConfig> = {}): ReportsConfig {
  return {
    serverUrl: 'http://127.0.0.1:5006',
    password: '',
    sessionToken: '',
    encryptionPassword: '',
    syncId: 'sync-1',
    dataDir: '/tmp/data',
    cacheTtlSec: 60,
    lockTimeoutSec: 10,
    noLock: false,
    cliEntry: '',
    apiPath: '',
    coreDir: '',
    ...overrides,
  }
}

/** 造一个文件系统替身：只认得列出的路径。 */
function ioOf(files: string[], pathValue = '/usr/bin:/opt/npm/bin'): ReportsIo {
  const known = new Set(files)
  return {
    fs: {
      mkdirExclusive: async () => 'created' as const,
      mkdirp: async () => undefined,
      rmdir: async () => undefined,
      readdir: async () => [],
      readText: async () => undefined,
      writeTextAtomic: async () => undefined,
      remove: async () => undefined,
      mtimeMs: async () => undefined,
      touch: async () => undefined,
      exists: async (path: string) => known.has(path),
      isDirectory: async () => false,
      realpath: async (path: string) => path,
    },
    http: { getText: async () => undefined },
    now: () => 0,
    sleep: async () => undefined,
    pid: 1,
    randomHex: () => 'ab',
    homedir: () => '/home/tester',
    env: { PATH: pathValue },
  }
}

test('显式 --api-path 优先，指向不存在的文件即报错', async () => {
  const resolved = await resolveApiPath(
    configOf({ apiPath: '/opt/api/index.js', cliEntry: '/opt/cli/dist/cli.js' }),
    ioOf(['/opt/api/index.js', '/opt/cli/dist/cli.js']),
  )
  assert.equal(resolved, '/opt/api/index.js')

  await assert.rejects(
    async () => await resolveApiPath(configOf({ apiPath: '/opt/api/missing.js' }), ioOf([])),
    /官方 CLI 入口不存在：\/opt\/api\/missing\.js/,
  )
})

test('PATH 里没有 actual 且没给入口时，报错说明怎么给', async () => {
  await assert.rejects(
    async () => await resolveApiPath(configOf(), ioOf([], '/usr/bin')),
    /既没有官方 CLI 入口（--cli-entry 或 DSH_ACTUAL_CLI_ENTRY），PATH 里也没有 actual/,
  )
})

test('PATH 兜底找到 actual 后，从它解析 @actual-app/api（解析不到即报错）', async () => {
  await assert.rejects(
    async () => await resolveApiPath(configOf(), ioOf(['/opt/npm/bin/actual'], '/opt/npm/bin')),
    /无法从官方 CLI（\/opt\/npm\/bin\/actual）解析 @actual-app\/api/,
  )
})
