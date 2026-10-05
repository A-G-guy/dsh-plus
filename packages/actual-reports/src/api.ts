/**
 * 官方 api 的定位与加载：**不声明依赖、不校验版本**，而是从「部署方已安装的官方
 * CLI」现场解析它自带的 `@actual-app/api`——版本天然与用户环境一致，本包体积零增长。
 *
 * 失败一律显式报错并给出处置建议；只做结构自检（函数在不在），不做版本判定。
 * @module @dsh-plus/actual-reports/api
 */

import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ReportsConfig } from './env.ts'
import { joinPath, type ReportsIo } from './node-io.ts'

/** 官方查询构造器窄面（`@actual-app/core/shared/query` 的用到部分）。 */
export interface QueryBuilder {
  filter(expr: unknown): QueryBuilder
  groupBy(fields: unknown[]): QueryBuilder
  select(fields: unknown[]): QueryBuilder
  serialize(): unknown
}

/** 官方 api 模块的最小结构面（本包只用到这些）。 */
export interface ActualApiModule {
  /** 初始化并返回进程内 server 句柄（官方以返回值替代已废弃的 `internal`）。 */
  init(config: Record<string, unknown>): Promise<ActualApiLib | undefined>
  shutdown(): Promise<void>
  downloadBudget(syncId: string, options?: { password?: string }): Promise<void>
  loadBudget(id: string): Promise<void>
  sync(): Promise<void>
  getBudgets(): Promise<unknown[]>
  q(table: string): QueryBuilder
  /** 执行查询；官方要求传构造器对象（内部会 `serialize()`）。 */
  aqlQuery(query: QueryBuilder): Promise<{ data: unknown }>
}

/** 进程内 server 句柄：报表/仪表盘 handler 经它调用。 */
export interface ActualApiLib {
  send(name: string, args?: unknown): Promise<unknown>
}

/** 已加载的 api。 */
export interface LoadedApi {
  /** api 入口的绝对路径（诊断与错误文案用）。 */
  path: string
  module: ActualApiModule
}

/** 定位失败的统一文案。 */
function locateError(detail: string): Error {
  return new Error(
    `报表能力不可用：${detail}。` +
      '本工具不依赖固定版本的 @actual-app/api，而是复用官方 CLI 自带的那份——' +
      '请确认 `@actual-app/cli` 安装完整（npm install --location=global @actual-app/cli），' +
      '或用 --api-path 直接指定 api 入口。',
  )
}

/** PATH 中查找可执行文件（`actual` 这类裸命令名）。 */
async function searchPath(io: ReportsIo, command: string): Promise<string | undefined> {
  const pathValue = io.env.PATH ?? ''
  for (const dir of pathValue.split(':').filter((part) => part !== '')) {
    const candidate = joinPath(dir, command)
    if (await io.fs.exists(candidate)) return await io.fs.realpath(candidate)
  }
  return undefined
}

/** 把「官方 CLI 入口」解析成绝对文件路径（支持裸命令名与软链）。 */
export async function resolveCliEntry(io: ReportsIo, entry: string): Promise<string> {
  if (entry === '') throw locateError('未提供官方 CLI 入口')
  if (isAbsolute(entry) || entry.includes('/')) {
    if (!(await io.fs.exists(entry))) throw locateError(`官方 CLI 入口不存在：${entry}`)
    return await io.fs.realpath(entry)
  }
  const found = await searchPath(io, entry)
  if (found === undefined) throw locateError(`在 PATH 中找不到官方 CLI：${entry}`)
  return found
}

/**
 * 解析 `@actual-app/api` 入口。
 *
 * 顺序：显式 `--api-path`（或 `DSH_ACTUAL_API_PATH`）> 官方 CLI 入口所在包的依赖解析。
 * 官方 CLI 入口来源：`--cli-entry` / `DSH_ACTUAL_CLI_ENTRY`，都没有则在 PATH 里找
 * `actual`（与官方 CLI「自带一份 api」的用法一致）。
 *
 * @throws 三者都不可用时抛出带指引的错误。
 */
export async function resolveApiPath(config: ReportsConfig, io: ReportsIo): Promise<string> {
  if (config.apiPath !== '') {
    const path = await resolveCliEntry(io, config.apiPath)
    return path
  }
  const cliEntry = config.cliEntry === '' ? await searchPath(io, 'actual') : config.cliEntry
  if (cliEntry === undefined) {
    throw locateError(
      '既没有官方 CLI 入口（--cli-entry 或 DSH_ACTUAL_CLI_ENTRY），PATH 里也没有 actual',
    )
  }
  const cliPath = await resolveCliEntry(io, cliEntry)
  try {
    const require = createRequire(cliPath)
    return require.resolve('@actual-app/api')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw locateError(`无法从官方 CLI（${cliPath}）解析 @actual-app/api：${detail}`)
  }
}

/** 结构自检：缺哪个函数就报哪个（不判版本）。 */
export function assertApiModule(value: unknown, path: string): ActualApiModule {
  const required = [
    'init',
    'shutdown',
    'downloadBudget',
    'loadBudget',
    'sync',
    'getBudgets',
    'q',
    'aqlQuery',
  ] as const
  if (typeof value !== 'object' || value === null) {
    throw locateError(`api 入口不是模块对象：${path}`)
  }
  const record = value as Record<string, unknown>
  const missing = required.filter((name) => typeof record[name] !== 'function')
  if (missing.length > 0) {
    throw locateError(`api 入口缺少必需函数 ${missing.join(', ')}：${path}`)
  }
  return value as ActualApiModule
}

/**
 * 加载 api 模块（动态 import，不静态依赖）。
 * @throws 模块无法加载或结构不符时抛出。
 */
export async function loadApi(path: string): Promise<LoadedApi> {
  let imported: unknown
  try {
    imported = await import(pathToFileURL(path).href)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw locateError(`加载 api 模块失败（${path}）：${detail}`)
  }
  return { path, module: assertApiModule(imported, path) }
}
