/**
 * 配置解析：与官方 CLI 同名的环境变量与默认值（`ACTUAL_*`），外加本工具自己的
 * 两个定位项（官方 CLI 入口 / api 入口）。
 *
 * 取值顺序与官方一致：命令行 > 环境变量（含 `_FILE` 变体）> 默认值；任何缺失或
 * 非法的边界输入都在此层显式报错，不做静默兜底。
 * @module @dsh-plus/actual-reports/env
 */

import { joinPath } from './node-io.ts'

/** 官方 CLI 的默认缓存根（逐字一致，才能共用缓存与锁）。 */
const DEFAULT_DATA_DIR_SUFFIX = ['.actual-cli', 'data'] as const

/** 默认缓存 TTL 与锁等待（官方 CLI 的默认值）。 */
const DEFAULT_CACHE_TTL_SEC = 60
const DEFAULT_LOCK_TIMEOUT_SEC = 10

/** 命令行可覆盖项（其余全部来自环境）。 */
export interface ConfigOverrides {
  serverUrl?: string
  syncId?: string
  dataDir?: string
  /** 官方 CLI 入口路径（用于定位它自带的 @actual-app/api）。 */
  cliEntry?: string
  /** 直接指定 @actual-app/api 入口（调试/自定义部署用）。 */
  apiPath?: string
}

/** 解析所需的外部事实（注入以便单测）。 */
export interface ConfigDeps {
  env: Record<string, string | undefined>
  /** 读文本文件；不存在返回 undefined。 */
  readTextFile(path: string): Promise<string | undefined>
  homedir(): string
}

/** 解析结果（不含任何派生或缓存状态）。 */
export interface ReportsConfig {
  serverUrl: string
  password: string
  sessionToken: string
  encryptionPassword: string
  syncId: string
  dataDir: string
  cacheTtlSec: number
  lockTimeoutSec: number
  noLock: boolean
  /** 官方 CLI 入口（可能为空：此时必须给出 apiPath）。 */
  cliEntry: string
  /** 显式 api 入口（可能为空）。 */
  apiPath: string
}

/** 非负整数环境变量解析；给了非法值即报错。 */
export function parseNonNegativeInt(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`环境变量 ${name} 必须是非负整数，实际为 ${JSON.stringify(raw)}`)
  }
  return value
}

/** 布尔环境变量解析：只认 true/false/1/0（与官方一致）。 */
export function parseBooleanFlag(
  raw: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new Error(`环境变量 ${name} 只接受 true/false/1/0，实际为 ${JSON.stringify(raw)}`)
}

/**
 * 读 `_FILE` 变体：官方约定该变量优先于普通变量。
 * @throws 变量已设置但文件读不到时抛出（不静默回落到普通变量）。
 */
async function readSecretFile(deps: ConfigDeps, fileVar: string): Promise<string | undefined> {
  const path = deps.env[fileVar]
  if (path === undefined || path === '') return undefined
  const content = await deps.readTextFile(path)
  if (content === undefined) {
    throw new Error(`环境变量 ${fileVar} 指向的文件读不到：${path}`)
  }
  return content.trim()
}

/** 取密钥：`_FILE` 变体 > 普通环境变量。 */
async function secretOf(deps: ConfigDeps, fileVar: string, plainVar: string): Promise<string> {
  const fromFile = await readSecretFile(deps, fileVar)
  if (fromFile !== undefined) return fromFile
  return deps.env[plainVar] ?? ''
}

/** 覆盖项优先，其次环境变量，最后默认值。 */
function pick(override: string | undefined, envValue: string | undefined): string {
  if (override !== undefined && override !== '') return override
  return envValue ?? ''
}

/**
 * 解析配置。
 * @throws serverUrl 缺失、认证缺失或数值/布尔变量非法时抛出。
 */
export async function resolveConfig(
  overrides: ConfigOverrides,
  deps: ConfigDeps,
): Promise<ReportsConfig> {
  const env = deps.env
  const serverUrl = pick(overrides.serverUrl, env.ACTUAL_SERVER_URL)
  if (serverUrl === '') {
    throw new Error(
      '缺少服务端地址：请设置 ACTUAL_SERVER_URL（或用 --server-url 指定），例如 http://127.0.0.1:5006。',
    )
  }
  const password = await secretOf(deps, 'ACTUAL_PASSWORD_FILE', 'ACTUAL_PASSWORD')
  const sessionToken = await secretOf(deps, 'ACTUAL_SESSION_TOKEN_FILE', 'ACTUAL_SESSION_TOKEN')
  if (password === '' && sessionToken === '') {
    throw new Error(
      '缺少认证信息：请设置 ACTUAL_PASSWORD（或 ACTUAL_SESSION_TOKEN），也可用对应的 _FILE 变体指向密钥文件。',
    )
  }
  const dataDir = pick(overrides.dataDir, env.ACTUAL_DATA_DIR)
  return {
    serverUrl,
    password,
    sessionToken,
    encryptionPassword: await secretOf(
      deps,
      'ACTUAL_ENCRYPTION_PASSWORD_FILE',
      'ACTUAL_ENCRYPTION_PASSWORD',
    ),
    syncId: pick(overrides.syncId, env.ACTUAL_SYNC_ID),
    dataDir: dataDir === '' ? joinPath(deps.homedir(), ...DEFAULT_DATA_DIR_SUFFIX) : dataDir,
    cacheTtlSec: parseNonNegativeInt(
      env.ACTUAL_CACHE_TTL,
      'ACTUAL_CACHE_TTL',
      DEFAULT_CACHE_TTL_SEC,
    ),
    lockTimeoutSec: parseNonNegativeInt(
      env.ACTUAL_LOCK_TIMEOUT,
      'ACTUAL_LOCK_TIMEOUT',
      DEFAULT_LOCK_TIMEOUT_SEC,
    ),
    noLock: parseBooleanFlag(env.ACTUAL_NO_LOCK, 'ACTUAL_NO_LOCK', false),
    cliEntry: pick(overrides.cliEntry, env.DSH_ACTUAL_CLI_ENTRY),
    apiPath: pick(overrides.apiPath, env.DSH_ACTUAL_API_PATH),
  }
}
