/**
 * HTTP 路由层：`/dsh-plus/web-terminal` 前缀下的 REST 端点 + WS 升级路由。
 * 只做方法/载荷解析、访问接缝与错误映射；会话语义在 registry。
 *
 * 安全接缝：`web-terminal/access` 事件（serial）在每个请求与升级前发出，
 * 任何监听器抛错即拒绝（403 / 拒绝升级），供统一安全插件实现鉴权。
 * @module web-terminal/http-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ApiErrorBody, CreateRequest, TerminalErrorCode } from './protocol.ts'
import { ROUTE_PREFIX } from './protocol.ts'
import { TerminalRegistryError } from './registry.ts'
import { isJsonRequest, isTrustedRequest } from './trust.ts'
import { handleUpgrade } from './ws-api.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * 终端 API 访问接缝（serial）：监听器抛错即拒绝该请求/升级（403）。
     * @param info - 方法、端点与目标会话 id（若有）。
     */
    'web-terminal/access'(info: { method: string; endpoint: string; sessionId?: string }): void
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function registryErrorStatus(code: TerminalErrorCode): number {
  switch (code) {
    case 'too-many-sessions':
      return 429
    case 'no-session':
      return 404
    case 'name-invalid':
    case 'input-too-large':
    case 'invalid-size':
      return 400
    case 'disabled':
      return 503
    case 'access-denied':
      return 403
    default:
      return 500
  }
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof TerminalRegistryError) {
    const body: ApiErrorBody = { error: error.message, code: error.code }
    sendJson(res, registryErrorStatus(error.code), body)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, 500, { error: message, code: 'internal' } satisfies ApiErrorBody)
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {} as T
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new TerminalRegistryError('request body must be valid JSON', 'name-invalid')
  }
}

type HttpHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

function wrap(ctx: Context, endpoint: string, handler: HttpHandler): HttpHandler {
  const logger = ctx.logger('web-terminal')
  return async (req, res, url) => {
    try {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, {
          error: 'origin mismatch',
          code: 'access-denied',
        } satisfies ApiErrorBody)
        return
      }
      await ctx.serial('web-terminal/access', {
        method: req.method ?? '?',
        endpoint,
        sessionId: url.searchParams.get('sessionId') ?? undefined,
      })
      await handler(req, res, url)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`terminal api ${endpoint} failed: ${message}`)
      if (!res.headersSent) sendError(res, error)
      else res.end()
    }
  }
}

/** 注册 REST 路由 + WS 升级路由（webServer 由 inject 保证存在）。 */
export function registerHttpApi(ctx: Context): void {
  const service = ctx.webTerminal
  const handlers: Record<string, HttpHandler> = {
    '/create': wrap(ctx, '/create', async (req, res) => {
      if (!isJsonRequest(req)) {
        sendJson(res, 415, {
          error: 'content-type must be application/json',
        } satisfies ApiErrorBody)
        return
      }
      if (!service.config().enabled) {
        sendJson(res, 503, {
          error: 'web-terminal is disabled',
          code: 'disabled',
        } satisfies ApiErrorBody)
        return
      }
      const body = await readJsonBody<CreateRequest>(req)
      sendJson(res, 200, { session: service.create(body) })
    }),
    '/list': wrap(ctx, '/list', async (_req, res) => {
      sendJson(res, 200, { sessions: service.list(), maxSessions: service.config().maxSessions })
    }),
    '/kill': wrap(ctx, '/kill', async (req, res) => {
      const body = await readJsonBody<{ sessionId: string }>(req)
      const killed = await service.kill(body.sessionId ?? '')
      sendJson(res, 200, { killed })
    }),
    '/rename': wrap(ctx, '/rename', async (req, res) => {
      const body = await readJsonBody<{ sessionId: string; name: string }>(req)
      sendJson(res, 200, { session: service.rename(body.sessionId ?? '', body.name ?? '') })
    }),
  }

  const disposeHttp = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === ROUTE_PREFIX) {
        sendJson(res, 200, { ok: true, ws: `${ROUTE_PREFIX}/ws` })
        return
      }
      const endpoint = url.pathname.slice(ROUTE_PREFIX.length)
      if (endpoint === '/ws') {
        // 普通 GET 到升级路径：对齐官方语义拒绝（426）。
        res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8', upgrade: 'websocket' })
        res.end('websocket upgrade required')
        return
      }
      const handler = handlers[endpoint]
      if (handler === undefined) {
        sendJson(res, 404, { error: `unknown endpoint: ${endpoint}` } satisfies ApiErrorBody)
        return
      }
      void handler(req, res, url)
    },
  })

  const disposeUpgrade = ctx.webServer.registerUpgrade({
    path: `${ROUTE_PREFIX}/ws`,
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      handleUpgrade(ctx, req, socket, head)
    },
  })

  ctx.effect(
    () => () => {
      disposeHttp()
      disposeUpgrade()
    },
    'web-terminal: routes',
  )
}
