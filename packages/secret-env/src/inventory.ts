/**
 * 索引解析与端点线型（从 service 拆出，规约模块规模；纯函数+DTO，零依赖）。
 * @module secret-env/inventory
 */

import type { SecretMeta } from './config.ts'
import { envNameOf, suffixOf } from './names.ts'

/** 一条会话级密钥（内存态；once = 首次注入后自毁）。 */
export interface SessionSecret {
  value: string
  description: string
  once: boolean
  createdAt: string
}

/** 列表端点的全局条目（describe 视图，绝无值）。 */
export interface GlobalEntry {
  name: string
  envName: string
  description: string
  configured: boolean
  source?: string
  writable: boolean
  /** 会话视图：该变量在本会话被屏蔽（无 sessionId 的调用恒为 false）。 */
  masked: boolean
}

/** 列表端点的会话条目。 */
export interface SessionEntry {
  name: string
  envName: string
  description: string
  once: boolean
  createdAt: string
}

/**
 * 列表端点的继承条目：宿主进程环境里已存在的 DSH_VAR_* 变量
 * （非本插件索引管理；默认纳入注入）。masked = 生效屏蔽态，
 * globallyMasked = 是否由全局屏蔽导致（会话视图里据此禁用会话级开关）。
 */
export interface InheritedEntry {
  name: string
  envName: string
  masked: boolean
  globallyMasked: boolean
}

/** 从索引数据解析全局密钥元数据列表（宽容过滤非法项）。 */
export function asMeta(value: unknown): SecretMeta[] {
  if (value === undefined || value === null || typeof value !== 'object') return []
  const list = (value as { secrets?: unknown }).secrets
  if (!Array.isArray(list)) return []
  return list
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      description: typeof item.description === 'string' ? item.description : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    }))
    .filter((item) => item.name.length > 0)
}

/** 从同一索引数据解析全局屏蔽名单（与 secrets 共一个 settings 命名空间）。 */
export function asMasked(value: unknown): string[] {
  if (value === undefined || value === null || typeof value !== 'object') return []
  const list = (value as { masked?: unknown }).masked
  if (!Array.isArray(list)) return []
  return list.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/** 继承变量后缀：给定进程环境里的 DSH_VAR_* 且不在索引内（按名排序）。 */
export function inheritedSuffixesOf(
  env: Record<string, string | undefined>,
  indexed: ReadonlySet<string>,
): string[] {
  const found: string[] = []
  for (const key of Object.keys(env)) {
    const suffix = suffixOf(key)
    if (suffix !== undefined && !indexed.has(suffix)) found.push(suffix)
  }
  return found.sort()
}

/** 拼装继承条目列表（list 端点的 inherited 段）。 */
export function inheritedEntriesOf(
  suffixes: readonly string[],
  globalMasked: ReadonlySet<string>,
  sessionMask: ReadonlySet<string> | undefined,
): InheritedEntry[] {
  return suffixes.map((name) => {
    const globally = globalMasked.has(name)
    return {
      name,
      envName: envNameOf(name),
      masked: globally || sessionMask?.has(name) === true,
      globallyMasked: globally,
    }
  })
}
