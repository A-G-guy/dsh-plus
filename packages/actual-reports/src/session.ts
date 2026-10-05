/**
 * 会话：与官方 CLI 同序的连接仪式（init → 锁 → 缓存决策 → 载入/同步 → 执行 →
 * 写操作后再 sync → shutdown），因此两条链路共用同一份缓存、同一把锁、同一套语义。
 *
 * 与本包其余模块一样，I/O 全经注入；任何能力缺失都在此处或调用点显式报错。
 * @module @dsh-plus/actual-reports/session
 */

import type { ActualApiLib, ActualApiModule, LoadedApi } from './api.ts'
import { type CacheState, decideSyncAction, readCacheState, writeCacheState } from './cache.ts'
import type { ReportsConfig } from './env.ts'
import { acquireBudgetLock, metaDirOf, type Release } from './lock.ts'
import type { ReportsIo } from './node-io.ts'

/** 一次预算会话的执行上下文。 */
export interface BudgetContext {
  api: ActualApiModule
  /** 进程内 server 句柄（`report/*`、`dashboard-*` 等 handler 经它调用）。 */
  lib: ActualApiLib
  /** api 入口路径（诊断文案用）。 */
  apiPath: string
  /**
   * 调一个官方 server handler。
   * @throws handler 缺失或执行失败时抛出（附 handler 名与原始原因）。
   */
  call(name: string, args?: unknown): Promise<unknown>
}

/** 会话选项。 */
export interface SessionOptions {
  /** 本次是否写预算：决定锁模式与收尾 sync。 */
  mutates: boolean
  /** 诊断日志出口（verbose 时由 CLI 接上）。 */
  log: (message: string) => void
}

/** 错误文本提取。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 初始化 api 并取回进程内句柄。
 * @throws 认证被拒、init 未返回句柄时抛出（后者说明该 api 版本不提供 handler 调用面）。
 */
async function initApi(
  config: ReportsConfig,
  api: ActualApiModule,
  options: SessionOptions,
): Promise<ActualApiLib> {
  const base: Record<string, unknown> = {
    serverURL: config.serverUrl,
    dataDir: config.dataDir,
    verbose: false,
  }
  const initConfig =
    config.sessionToken !== ''
      ? { ...base, sessionToken: config.sessionToken }
      : { ...base, password: config.password }
  let lib: ActualApiLib | undefined
  try {
    lib = await api.init(initConfig)
  } catch (error) {
    throw new Error(`连接 Actual 服务端失败（${config.serverUrl}）：${messageOf(error)}`)
  }
  if (lib === undefined || typeof lib.send !== 'function') {
    throw new Error(
      '报表能力不可用：当前安装的 @actual-app/api 的 init() 没有返回进程内句柄，' +
        '无法调用 report/dashboard handler。请更新官方 CLI（npm install --location=global @actual-app/cli）后重试。',
    )
  }
  options.log(`已连接 ${config.serverUrl}`)
  return lib
}

/** 由 syncId 反查本地预算 id（官方同法：groupId 或 cloudFileId 命中）。 */
async function resolveBudgetId(api: ActualApiModule, syncId: string): Promise<string> {
  const budgets = await api.getBudgets()
  for (const entry of budgets) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string') continue
    if (record.groupId === syncId || record.cloudFileId === syncId) return record.id
  }
  throw new Error(
    `下载后仍找不到 syncId ${syncId} 对应的本地预算。` +
      '请确认 ACTUAL_SYNC_ID 是该预算的 groupId（`actual budgets list` 里的 groupId，而不是 cloudFileId）。',
  )
}

/** 首次下载并落缓存状态。 */
async function downloadBudget(
  config: ReportsConfig,
  api: ActualApiModule,
  metaDir: string,
  io: ReportsIo,
): Promise<CacheState> {
  await api.downloadBudget(config.syncId, { password: config.encryptionPassword })
  const budgetId = await resolveBudgetId(api, config.syncId)
  const now = io.now()
  const state: CacheState = {
    version: 1,
    syncId: config.syncId,
    budgetId,
    serverUrl: config.serverUrl,
    lastSyncedAt: now,
    lastDownloadedAt: now,
  }
  await writeCacheState(metaDir, state, io)
  return state
}

/** 按缓存决策把预算载入进程（与官方 withConnection 的三种分支一致）。 */
async function loadBudget(
  config: ReportsConfig,
  api: ActualApiModule,
  metaDir: string,
  options: SessionOptions,
  io: ReportsIo,
): Promise<CacheState> {
  const cached = await readCacheState(metaDir, io)
  const decision = decideSyncAction({
    state: cached,
    syncId: config.syncId,
    serverUrl: config.serverUrl,
    now: io.now(),
    ttlMs: config.cacheTtlSec * 1000,
    mutates: options.mutates,
    encrypted: config.encryptionPassword !== '',
  })
  if (decision.action === 'download') {
    options.log('下载预算（首次或缓存失效）…')
    return await downloadBudget(config, api, metaDir, io)
  }
  if (decision.action === 'skip') {
    options.log('使用本地缓存预算（未过期）')
    await api.loadBudget(decision.state.budgetId)
    return decision.state
  }
  if (config.encryptionPassword !== '') {
    options.log('同步预算（加密预算走重新下载）…')
    await api.downloadBudget(config.syncId, { password: config.encryptionPassword })
    const state: CacheState = { ...decision.state, lastSyncedAt: io.now() }
    await writeCacheState(metaDir, state, io)
    return state
  }
  options.log('同步预算…')
  await api.loadBudget(decision.state.budgetId)
  await api.sync()
  const state: CacheState = { ...decision.state, lastSyncedAt: io.now() }
  await writeCacheState(metaDir, state, io)
  return state
}

/** 组装执行上下文（handler 调用统一加名与原因）。 */
function contextOf(loaded: LoadedApi, lib: ActualApiLib): BudgetContext {
  return {
    api: loaded.module,
    lib,
    apiPath: loaded.path,
    call: async (name, args) => {
      try {
        return await lib.send(name, args)
      } catch (error) {
        throw new Error(`Actual 服务端处理 ${name} 失败：${messageOf(error)}`)
      }
    },
  }
}

/**
 * 在预算会话内执行一次操作。
 *
 * @param config - 已解析配置（syncId 必填）。
 * @param loaded - 已加载的官方 api。
 * @param options - 是否写、日志出口。
 * @param io - 注入 I/O 面。
 * @param fn - 实际操作；抛错即原样上抛（锁与 shutdown 仍会释放）。
 * @throws syncId 缺失、加锁超时、初始化/载入/同步失败时抛出。
 */
export async function withBudget<T>(
  config: ReportsConfig,
  loaded: LoadedApi,
  options: SessionOptions,
  io: ReportsIo,
  fn: (ctx: BudgetContext) => Promise<T>,
): Promise<T> {
  if (config.syncId === '') {
    throw new Error(
      '缺少预算 syncId：请设置 ACTUAL_SYNC_ID（或用 --sync-id 指定），' +
        '取值是 `actual budgets list` 里的 groupId。',
    )
  }
  const api = loaded.module
  const lib = await initApi(config, api, options)
  const ctx = contextOf(loaded, lib)
  const metaDir = metaDirOf(config.dataDir, config.syncId)
  let release: Release | undefined
  try {
    if (!config.noLock) {
      release = await acquireBudgetLock(
        config.dataDir,
        config.syncId,
        {
          mode: options.mutates ? 'exclusive' : 'shared',
          timeoutMs: config.lockTimeoutSec * 1000,
        },
        io,
      )
    }
    let state = await loadBudget(config, api, metaDir, options, io)
    const result = await fn(ctx)
    if (options.mutates) {
      options.log('推送变更…')
      await api.sync()
      state = { ...state, lastSyncedAt: io.now() }
      await writeCacheState(metaDir, state, io)
    }
    return result
  } finally {
    if (release !== undefined) await release()
    await api.shutdown().catch(() => undefined)
  }
}
