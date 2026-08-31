/**
 * 自有 HTTP 端点（/dsh-plus/gate 前缀，围栏豁免路径）：
 * - GET /dsh-plus/gate/status     — 当前客户端判定状态（配置卡片诊断）
 * - GET /dsh-plus/gate/launch-url — 当前进程认证链接（仅本机直连可用的管理通道）
 *
 * 与官方认证合并后不再提供 login 端点：令牌校验完全由官方 authorizeIndex
 * 完成（token 输入页纯客户端跳转 `/?token=`），无失败节流面。
 * handler 工厂与路由注册分离，测试直接驱动 handler（禁起真实服务器）。
 * @module access-gate/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { AccessGateConfig } from './config.ts'
import { decideGate } from './decision.ts'
import { isLoopbackAddress } from './ip.ts'

export const GATE_ROUTE = '/dsh-plus/gate'

export interface RouteDeps {
  config: () => AccessGateConfig
  /** 官方 browser-auth cookie 校验（委托 connection.requestRejection）。 */
  officialAuth: (req: IncomingMessage) => boolean
  /** 生成当前进程认证链接（委托 connection.authenticatedUrl）。 */
  authenticatedUrl: (baseUrl: string) => string
  /** 客户端 IP 还原（与围栏同一规则）；缺省时从请求自身推导。 */
  resolveClientIp?: (req: IncomingMessage) => string | undefined
  onError?: (message: string) => void
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
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

/**
 * 本机直连判定（launch-url 管理通道专用）：socket 为 loopback 且不带
 * XFF（带 XFF 说明经代理，真实客户端在远端，不属本机管理通道）。
 */
function isDirectLoopback(req: IncomingMessage): boolean {
  if (req.headers['x-forwarded-for'] !== undefined) return false
  return isLoopbackAddress(req.socket?.remoteAddress)
}

export function createGateRoutes(
  deps: RouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const resolveIp = deps.resolveClientIp ?? clientIpOf

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
      deps.officialAuth(req),
    )
    sendJson(res, 200, {
      enabled: config.enabled,
      verdict: decision.verdict,
      clientIp: decision.clientIp ?? resolveIp(req) ?? null,
      reason: decision.reason ?? null,
      officialAuthed: deps.officialAuth(req),
      ipFenceActive: config.allowedIps.length > 0,
      invalidEntries: decision.invalidEntries ?? [],
      allowedCount: config.allowedIps.length,
    })
  }

  const handleLaunchUrl = (req: IncomingMessage, res: ServerResponse): void => {
    if (!isDirectLoopback(req)) {
      sendJson(res, 403, { error: 'loopback only' })
      return
    }
    // 令牌本身跨 authority 有效（官方交换不校验 authority），支持按指定
    // host/scheme 生成变体（如 tailscale 域名）；缺省取请求的 loopback host。
    const url = new URL(req.url ?? '/', 'http://localhost')
    const host = url.searchParams.get('host') ?? req.headers.host
    if (typeof host !== 'string' || host === '') {
      sendJson(res, 400, { error: 'missing host' })
      return
    }
    const scheme = url.searchParams.get('scheme') ?? 'http'
    try {
      sendJson(res, 200, { url: deps.authenticatedUrl(`${scheme}://${host}`) })
    } catch {
      sendJson(res, 400, { error: 'invalid host' })
    }
  }

  return async (req, res) => {
    try {
      const sub = new URL(req.url ?? '/', 'http://localhost').pathname.slice(GATE_ROUTE.length)
      const method = req.method ?? 'GET'
      if (sub === '/status') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'GET only' })
        return handleStatus(req, res)
      }
      if (sub === '/launch-url') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'GET only' })
        return handleLaunchUrl(req, res)
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

/** 注册路由（webServer 缺失时由调用方保证不调用）。 */
export function registerGateRoutes(ctx: Context, deps: RouteDeps): void {
  ctx.webServer.register({
    kind: 'prefix',
    path: GATE_ROUTE,
    handler: createGateRoutes(deps),
  })
}
