/**
 * 预算目录锁：与官方 CLI 共用同一套门闩协议，因此本工具与官方 CLI（乃至另一个
 * 本工具进程）之间能真正互斥，而不是各锁各的。
 *
 * 协议（读自 `@actual-app/cli` 的 src/lock.ts 行为，路径约定必须一致）：
 * - 元数据目录 `<dataDir>/.actual-cli/<syncId>`；门闩 = 该目录下的 `lock` 子目录，
 *   `mkdir` 成功即持锁，已存在即视为争用并重试；
 * - 读者标记 = `<meta>/readers/<pid>-<hex>`，写标记前必须先持门闩；
 * - 独占 = 持门闩 + 等读者目录内无存活 pid；共享 = 持门闩期间落一个读者标记；
 * - 门闩 `mtime` 超过 STALE_LOCK_MS 视为崩溃残留，清理后重试；持锁期间按
 *   HEARTBEAT_MS 触碰 mtime 续租，长任务不会被误判为陈旧。
 * @module @dsh-plus/actual-reports/lock
 */

import { joinPath, pidAlive, type ReportsIo } from './node-io.ts'

/** 陈旧门闩判定阈值（与官方一致的 30s）。 */
export const STALE_LOCK_MS = 30_000

/** 门闩续租间隔（官方 proper-lockfile 的 update 默认值同量级）。 */
export const HEARTBEAT_MS = 10_000

/** 等待读者清空的轮询间隔。 */
const READER_POLL_MS = 100

/** 争用重试的退避区间。 */
const RETRY_MIN_MS = 100
const RETRY_MAX_MS = 500

/** 门闩文件名与读者目录名（协议的一部分，不得改动）。 */
const LOCK_DIR_NAME = 'lock'
const READERS_DIR_NAME = 'readers'

/** 锁模式：读用共享、写用独占。 */
export type LockMode = 'shared' | 'exclusive'

/** 一次加锁的选项。 */
export interface LockOptions {
  mode: LockMode
  /** 总等待预算（毫秒）；超时抛出带指引的错误。 */
  timeoutMs: number
}

/** 释放函数（幂等）。 */
export type Release = () => Promise<void>

/** 预算元数据目录（官方 CLI 的缓存/锁根，必须逐字一致）。 */
export function metaDirOf(dataDir: string, syncId: string): string {
  return joinPath(dataDir, '.actual-cli', syncId)
}

/** 门闩目录路径。 */
function gatePathOf(metaDir: string): string {
  return joinPath(metaDir, LOCK_DIR_NAME)
}

/** 读者标记目录路径。 */
function readersPathOf(metaDir: string): string {
  return joinPath(metaDir, READERS_DIR_NAME)
}

/** 争用/超时的统一错误文案。 */
function lockTimeoutError(timeoutMs: number): Error {
  return new Error(
    `预算目录被另一个进程占用（已等待 ${Math.round(timeoutMs / 1000)}s）。` +
      '请稍后重试，或改用不同的 dataDir（ACTUAL_DATA_DIR）。',
  )
}

/** 读者标记文件名：`<pid>-<hex>`（官方同构，存活判定依赖首段 pid）。 */
function readerNameOf(io: ReportsIo): string {
  return `${io.pid}-${io.randomHex(6)}`
}

/** 清理读者目录中 pid 已消失的残留标记。 */
async function sweepStaleReaders(io: ReportsIo, metaDir: string): Promise<void> {
  const readers = readersPathOf(metaDir)
  for (const name of await io.fs.readdir(readers).catch(() => [])) {
    const pid = Number(name.split('-')[0])
    if (!Number.isFinite(pid) || !pidAlive(pid)) {
      await io.fs.remove(joinPath(readers, name))
    }
  }
}

/** 等读者目录清空；超时抛错。 */
async function waitForReadersEmpty(
  io: ReportsIo,
  metaDir: string,
  deadline: number,
): Promise<void> {
  const readers = readersPathOf(metaDir)
  while (io.now() < deadline) {
    await sweepStaleReaders(io, metaDir)
    if ((await io.fs.readdir(readers).catch(() => [])).length === 0) return
    await io.sleep(READER_POLL_MS)
  }
  throw lockTimeoutError(deadline - io.now() + READER_POLL_MS)
}

/** 退避时长：随重试次数增长，封顶 RETRY_MAX_MS。 */
function backoffMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_MIN_MS * (attempt + 1))
}

/**
 * 取门闩：mkdir 成功即持锁；已存在时按 mtime 判陈旧，陈旧则清理重试。
 * @returns 释放函数（含心跳停止）。
 */
async function acquireGate(io: ReportsIo, metaDir: string, deadline: number): Promise<Release> {
  const gate = gatePathOf(metaDir)
  await io.fs.mkdirp(metaDir)
  let attempt = 0
  for (;;) {
    if ((await io.fs.mkdirExclusive(gate)) === 'created') {
      const timer = setInterval(() => {
        void io.fs.touch(gate).catch(() => undefined)
      }, HEARTBEAT_MS)
      timer.unref?.()
      return async () => {
        clearInterval(timer)
        await io.fs.rmdir(gate)
      }
    }
    const mtime = await io.fs.mtimeMs(gate)
    if (mtime === undefined) continue
    if (io.now() - mtime > STALE_LOCK_MS) {
      await io.fs.rmdir(gate)
      continue
    }
    if (io.now() >= deadline) throw lockTimeoutError(deadline - io.now() + backoffMs(attempt))
    await io.sleep(backoffMs(attempt))
    attempt += 1
  }
}

/**
 * 获取预算目录锁。
 *
 * @param dataDir - 缓存根目录（与官方 CLI 的 ACTUAL_DATA_DIR 同一取值）。
 * @param syncId - 预算 sync ID。
 * @param options - 模式与等待预算。
 * @param io - 注入 I/O 面。
 * @returns 释放函数；调用方必须在 finally 中释放。
 */
export async function acquireBudgetLock(
  dataDir: string,
  syncId: string,
  options: LockOptions,
  io: ReportsIo,
): Promise<Release> {
  const metaDir = metaDirOf(dataDir, syncId)
  const deadline = io.now() + options.timeoutMs
  const releaseGate = await acquireGate(io, metaDir, deadline)
  if (options.mode === 'exclusive') {
    try {
      await waitForReadersEmpty(io, metaDir, deadline)
    } catch (error) {
      await releaseGate()
      throw error
    }
    return releaseGate
  }
  const readers = readersPathOf(metaDir)
  const marker = joinPath(readers, readerNameOf(io))
  try {
    await io.fs.mkdirp(readers)
    await io.fs.writeTextAtomic(marker, '')
  } catch (error) {
    await releaseGate()
    throw error
  }
  await releaseGate()
  let released = false
  return async () => {
    if (released) return
    released = true
    await io.fs.remove(marker)
  }
}
