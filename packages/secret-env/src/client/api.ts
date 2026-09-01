/**
 * 数据端点通道：GET list / POST set/unset（同源 fetch，值不上行到任何对话通道）。
 * @module secret-env/client/api
 */
import { getJson, postJson } from '@dsh-plus/shared/client'

export interface GlobalWireEntry {
  name: string
  envName: string
  description: string
  configured: boolean
  source?: string
  writable: boolean
  /** 会话视图：本会话已屏蔽（无 sessionId 的请求恒 false）。 */
  masked: boolean
}

export interface SessionWireEntry {
  name: string
  envName: string
  description: string
  once: boolean
  createdAt: string
}

/** 继承变量：宿主进程环境中已存在的 DSH_VAR_*（非本插件管理）。 */
export interface InheritedWireEntry {
  name: string
  envName: string
  /** 生效屏蔽态（全局或本会话）。 */
  masked: boolean
  /** 是否由全局屏蔽导致（会话视图据此禁用会话级开关）。 */
  globallyMasked: boolean
}

export interface SecretList {
  global: GlobalWireEntry[]
  session: SessionWireEntry[]
  inherited: InheritedWireEntry[]
}

interface WriteResult {
  ok: boolean
  error?: string
  message?: string
}

/** 端点错误：携带结构化错误码，UI 按码映射文案。 */
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export async function fetchSecrets(sessionId?: string): Promise<SecretList> {
  const query = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
  return getJson<SecretList>(`/dsh-plus/secret-env/list${query}`)
}

async function write(path: string, body: Record<string, unknown>): Promise<void> {
  try {
    // 非 2xx 时 postJson 抛 Error(body.error)，message 即结构化错误码。
    await postJson<WriteResult>(`/dsh-plus/secret-env/${path}`, body)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : 'internal')
  }
}

export function setGlobal(name: string, value: string, description: string): Promise<void> {
  return write('global/set', { name, value, description })
}

export function unsetGlobal(name: string): Promise<void> {
  return write('global/unset', { name })
}

export function setSession(
  sessionId: string,
  name: string,
  value: string,
  description: string,
  once: boolean,
): Promise<void> {
  return write('session/set', { sessionId, name, value, description, once })
}

export function unsetSession(sessionId: string, name: string): Promise<void> {
  return write('session/unset', { sessionId, name })
}

/** 屏蔽/恢复：sessionId 缺席为全局屏蔽（设置页），否则为会话级屏蔽。 */
export function setMask(name: string, masked: boolean, sessionId?: string): Promise<void> {
  return write('mask/set', { name, masked, sessionId })
}
