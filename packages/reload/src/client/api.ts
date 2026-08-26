/**
 * 自定义端点通道：/dsh-plus/reload 四个端点的 fetch 封装（same-origin）。
 * @module reload/client/api
 */

const ROUTE = '/dsh-plus/reload'

export interface PreflightInfo {
  ok: boolean
  reasons: string[]
}

export interface PrepareInfo {
  token: string
  expiresAt: number
  bootId: string
  runningAgents: number
  countdownSeconds: number
  pollTimeoutMs: number
  preflight: PreflightInfo
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly preflight?: PreflightInfo,
    readonly runningAgents?: number,
  ) {
    super(message)
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & {
    error?: string
    preflight?: PreflightInfo
    runningAgents?: number
  }
  if (!res.ok) {
    throw new ApiError(
      body.error ?? `HTTP ${res.status}`,
      res.status,
      body.preflight,
      body.runningAgents,
    )
  }
  return body
}

export interface HealthInfo {
  ok: boolean
  bootId: string
  /** 被动重启检测的轮询间隔毫秒数（0 = 关闭）；旧版 host 无此字段。 */
  watchdogIntervalMs?: number
}

export async function fetchHealth(): Promise<HealthInfo> {
  return parse(await fetch(`${ROUTE}/health`, { credentials: 'same-origin' }))
}

export async function postPrepare(): Promise<PrepareInfo> {
  return parse(
    await fetch(`${ROUTE}/prepare`, {
      method: 'POST',
      credentials: 'same-origin',
    }),
  )
}

export async function postConfirm(
  token: string,
  force: boolean,
): Promise<{ ok: boolean; etaMs: number; bootId: string }> {
  return parse(
    await fetch(`${ROUTE}/confirm`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, force }),
    }),
  )
}

export async function postCancel(token: string): Promise<void> {
  await fetch(`${ROUTE}/cancel`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => {
    // 取消失败（含进程已死）无须上报：倒计时遮罩关闭即视为本地放弃。
  })
}
