/**
 * 真实 I/O 面：文件系统、时钟、进程与随机数的唯一落地点。
 *
 * 领域逻辑（锁、缓存状态、会话）一律经注入的接口取用这些能力，因此单测可以
 * 用内存替身跑出确定性结果，也可以拿真实实现打在临时目录上。
 * @module @dsh-plus/actual-reports/node-io
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 文件系统窄面（只收本包用到的动作）。 */
export interface ReportsFs {
  /**
   * 以 mkdir 语义排他创建目录。
   * @returns `created` = 本次创建成功；`exists` = 已存在（调用方据此判定争用）。
   */
  mkdirExclusive(path: string): Promise<'created' | 'exists'>
  /** 创建目录（幂等）。 */
  mkdirp(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  readText(path: string): Promise<string | undefined>
  /** 原子写：同目录临时文件 + rename。 */
  writeTextAtomic(path: string, data: string): Promise<void>
  remove(path: string): Promise<void>
  /** 目录 mtime（毫秒）；不存在返回 undefined。 */
  mtimeMs(path: string): Promise<number | undefined>
  /** 触碰 mtime（心跳续租）。 */
  touch(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** 是否为目录（不存在返回 false）。 */
  isDirectory(path: string): Promise<boolean>
  /** 解析真实路径（软链展开）；不存在时抛错。 */
  realpath(path: string): Promise<string>
}

/** HTTP 取回的文本（非 2xx 时 text 为空串，只看 status）。 */
export interface HttpText {
  status: number
  text: string
}

/** HTTP 窄面（只收本包用到的动作）。
 *
 * 本包只访问 `serverUrl` 指向的 Actual 服务端：一是官方 API 的同步端点，二是
 * 它静态托管的客户端资产（`reference source` 读客户端语义时用）。
 */
export interface ReportsHttp {
  /**
   * GET 文本。
   * @returns 连不上/超时时返回 undefined（调用方据此给出显式错误），HTTP 状态照实返回。
   */
  getText(url: string, timeoutMs: number): Promise<HttpText | undefined>
}

/** 注入面：文件系统 + 网络 + 时间 + 进程事实。 */
export interface ReportsIo {
  fs: ReportsFs
  http: ReportsHttp
  now(): number
  sleep(ms: number): Promise<void>
  /** 当前进程号（读者标记与存活判定用）。 */
  pid: number
  /** 随机十六进制串（读者标记唯一化）。 */
  randomHex(bytes: number): string
  homedir(): string
  env: Record<string, string | undefined>
}

/** 取 errno code（非 Error 或缺失返回 undefined）。 */
function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/** 真实文件系统实现。 */
export const nodeFs: ReportsFs = {
  async mkdirExclusive(path) {
    try {
      await mkdir(path)
      return 'created'
    } catch (error) {
      if (codeOf(error) === 'EEXIST') return 'exists'
      throw error
    }
  },
  async mkdirp(path) {
    await mkdir(path, { recursive: true })
  },
  async rmdir(path) {
    await rm(path, { recursive: true, force: true })
  },
  async readdir(path) {
    return await readdir(path)
  },
  async readText(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return undefined
      throw error
    }
  },
  async writeTextAtomic(path, data) {
    const tmp = `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, data)
    await rename(tmp, path)
  },
  async remove(path) {
    await rm(path, { force: true, recursive: true })
  },
  async mtimeMs(path) {
    try {
      const info = await stat(path)
      return info.mtimeMs
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return undefined
      throw error
    }
  },
  async touch(path) {
    const now = new Date()
    await utimes(path, now, now)
  },
  async exists(path) {
    try {
      await stat(path)
      return true
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return false
      throw error
    }
  },
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory()
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return false
      throw error
    }
  },
  async realpath(path) {
    const { realpath } = await import('node:fs/promises')
    return await realpath(path)
  },
}

/** 进程存活判定：`kill(pid, 0)` 语义（EPERM 也算存活）。 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return codeOf(error) === 'EPERM'
  }
}

/** 真实 HTTP 实现（只走宿主 fetch，不引入依赖）。 */
export const nodeHttp: ReportsHttp = {
  async getText(url, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) return { status: response.status, text: '' }
      return { status: response.status, text: await response.text() }
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  },
}

/** 真实 I/O 面。 */
export function createNodeIo(): ReportsIo {
  return {
    fs: nodeFs,
    http: nodeHttp,
    now: () => Date.now(),
    sleep: async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)),
    pid: process.pid,
    randomHex: (bytes) => randomBytes(bytes).toString('hex'),
    homedir,
    env: process.env,
  }
}

/** 拼接路径（薄封装，避免各模块各自 import node:path）。 */
export function joinPath(...parts: string[]): string {
  return join(...parts)
}
