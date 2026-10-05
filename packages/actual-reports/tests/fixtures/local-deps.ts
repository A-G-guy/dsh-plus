/**
 * 测试替身：本地依赖（配置 + 内存文件系统 + 可编程 HTTP）。
 *
 * `reference` 族的动作只读本机与服务端资产，因此这里给一套确定性的替身：
 * 文件系统是内存表，HTTP 由用例按 URL 注册应答，时钟与随机数固定。
 * @module @dsh-plus/actual-reports/tests/fixtures/local-deps
 */

import type { ReportsConfig } from '../../src/env.ts'
import type { HttpText, ReportsFs, ReportsIo } from '../../src/node-io.ts'

/** HTTP 应答：字符串 = 200 正文；`{status}` = 指定状态码；`undefined` = 连不上。 */
export type HttpReply = string | { status: number } | undefined

/** 本地依赖替身。 */
export interface FakeLocal {
  config: ReportsConfig
  io: ReportsIo
  /** 直接读写替身文件系统（用例预置文件、断言缓存写入）。 */
  files: Map<string, string>
  /** 观察 HTTP 取回历史。 */
  requests: string[]
}

/** 造一份配置（默认值够用，用例按需覆盖）。 */
export function fakeConfig(overrides: Partial<ReportsConfig> = {}): ReportsConfig {
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

/** 造一套本地依赖替身。 */
export function fakeLocal(
  options: {
    config?: Partial<ReportsConfig>
    files?: Record<string, string>
    http?: Record<string, HttpReply>
  } = {},
): FakeLocal {
  const files = new Map<string, string>(Object.entries(options.files ?? {}))
  const requests: string[] = []
  const httpMap = options.http ?? {}
  const fs: ReportsFs = {
    mkdirExclusive: async () => 'created',
    mkdirp: async () => undefined,
    rmdir: async () => undefined,
    readdir: async (path) => {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const names = new Set<string>()
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue
        names.add((key.slice(prefix.length).split('/')[0] ?? '') as string)
      }
      return [...names]
    },
    readText: async (path) => files.get(path),
    writeTextAtomic: async (path, data) => {
      files.set(path, data)
    },
    remove: async (path) => {
      files.delete(path)
    },
    mtimeMs: async () => 0,
    touch: async () => undefined,
    exists: async (path) => files.has(path),
    isDirectory: async (path) => {
      const prefix = `${path}/`
      return [...files.keys()].some((key) => key.startsWith(prefix))
    },
    realpath: async (path) => path,
  }
  const io: ReportsIo = {
    fs,
    http: {
      async getText(url): Promise<HttpText | undefined> {
        requests.push(url)
        const reply = httpMap[url] ?? httpMap['*']
        if (reply === undefined) return undefined
        if (typeof reply === 'string') return { status: 200, text: reply }
        return { status: reply.status, text: '' }
      },
    },
    now: () => Date.parse('2025-03-15T00:00:00Z'),
    sleep: async () => undefined,
    pid: 4242,
    randomHex: () => 'ab',
    homedir: () => '/home/tester',
    env: { PATH: '/usr/bin' },
  }
  return { config: fakeConfig(options.config), io, files, requests }
}
