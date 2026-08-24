/**
 * 自有 HTTP 端点（/dsh-plus/gate 前缀，围栏豁免路径）：
 * - POST /dsh-plus/gate/login  — token 换 cookie（HttpOnly + SameSite=Strict）
 * - GET  /dsh-plus/gate/status — 当前客户端判定状态（登录页与卡片诊断）
 *
 * 登录失败节流：按客户端 IP 记录失败次数与冷却截止（惰性清理，无定时器）。
 * handler 工厂与路由注册分离，测试直接驱动 handler（禁起真实服务器）。
 * @module access-gate/routes
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { AccessGateConfig } from './config.ts'
import { decideGate } from './decision.ts'

export const GATE_ROUTE = '/dsh-plus/gate'

/** 节流状态（纯数据结构，可注入 clock 测试）。 */
export interface ThrottleState {
  fails: Map<string, { count: number; until: number }>
}

export function createThrottleState(): ThrottleState {
  return { fails: new Map() }
}

export interface RouteDeps {
  config: () => AccessGateConfig
  /** 客户端 IP 还原（与围栏同一规则）；缺省时从请求自身推导。 */
  resolveClientIp?: (req: IncomingMessage) => string | undefined
  throttle?: ThrottleState
  clock?: () => number
  onError?: (message: string) => void
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 解析 JSON body；非对象或解析失败返回 null。 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  if (!req.headers['content-type']?.includes('application/json')) return null
  try {
    const parsed: unknown = JSON.parse(await readBody(req))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** 默认客户端 IP 还原：XFF 最左优先，否则 socket 地址。 */
function clientIpOf(req: IncomingMessage): string | undefined {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const remote = req.socket?.remoteAddress
  if (remote === undefined || remote === '') return undefined
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote
}

/** 是否处于冷却期；冷却期满的条目惰性清除（计数中条目保留）。 */
function throttled(state: ThrottleState, ip: string, now: number): boolean {
  const entry = state.fails.get(ip)
  if (entry === undefined) return false
  if (entry.until > now) return true
  if (entry.until > 0) state.fails.delete(ip)
  return false
}

/** 记一次失败；达到阈值则进入冷却。 */
function recordFailure(
  state: ThrottleState,
  ip: string,
  limit: number,
  cooldownMs: number,
  now: number,
): void {
  const entry = state.fails.get(ip) ?? { count: 0, until: 0 }
  entry.count += 1
  if (entry.count >= limit) {
    entry.until = now + cooldownMs
    entry.count = 0
  }
  state.fails.set(ip, entry)
}

export function createGateRoutes(
  deps: RouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const throttle = deps.throttle ?? createThrottleState()
  const clock = deps.clock ?? Date.now
  const resolveIp = deps.resolveClientIp ?? clientIpOf

  const handleLogin = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const config = deps.config()
    const body = await readJson(req)
    if (body === undefined || body === null || typeof body.token !== 'string') {
      sendJson(res, 400, { error: 'invalid json body' })
      return
    }
    const ip = resolveIp(req) ?? 'unknown'
    const now = clock()
    if (throttled(throttle, ip, now)) {
      sendJson(res, 429, { error: 'too many attempts' })
      return
    }
    const ok = verifyToken(body.token, config.token)
    if (!ok) {
      recordFailure(throttle, ip, config.loginFailLimit, config.loginCooldownMs, now)
      sendJson(res, 403, { error: 'invalid token' })
      return
    }
    throttle.fails.delete(ip)
    const maxAge = config.cookieMaxAgeHours * 3600
    const cookie = `dsh_gate=${body.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
    sendJson(res, 200, { ok: true }, { 'set-cookie': cookie })
  }

  const handleStatus = (req: IncomingMessage, res: ServerResponse): void => {
    const config = deps.config()
    const decision = decideGate(
      {
        url: req.url ?? '/',
        method: req.method ?? 'GET',
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
      },
      config,
    )
    sendJson(res, 200, {
      enabled: config.enabled,
      verdict: decision.verdict,
      clientIp: decision.clientIp ?? null,
      reason: decision.reason ?? null,
      invalidEntries: decision.invalidEntries ?? [],
      tokenConfigured: config.token !== '',
      allowedCount: config.allowedIps.length,
    })
  }

  return async (req, res) => {
    try {
      const sub = new URL(req.url ?? '/', 'http://localhost').pathname.slice(GATE_ROUTE.length)
      const method = req.method ?? 'GET'
      if (sub === '/login') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
        return await handleLogin(req, res)
      }
      if (sub === '/status') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'GET only' })
        return handleStatus(req, res)
      }
      sendJson(res, 404, { error: 'unknown endpoint' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.onError?.(`gate api failed: ${message}`)
      if (!res.headersSent) sendJson(res, 500, { error: message })
      else res.end()
    }
  }
}

/** token 校验（sha256 + 常时比较）；空 token 通道关闭恒 false。 */
function verifyToken(candidate: string, expected: string): boolean {
  if (candidate === '' || expected === '') return false
  const a = createHash('sha256').update(candidate).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** 注册路由（webServer 缺失时由调用方保证不调用）。 */
export function registerGateRoutes(ctx: Context, deps: RouteDeps): void {
  ctx.webServer.register({
    kind: 'prefix',
    path: GATE_ROUTE,
    handler: createGateRoutes(deps),
  })
}
