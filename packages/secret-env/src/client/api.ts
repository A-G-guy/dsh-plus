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
}

export interface SessionWireEntry {
  name: string
  envName: string
  description: string
  once: boolean
  createdAt: string
}

export interface SecretList {
  global: GlobalWireEntry[]
  session: SessionWireEntry[]
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
