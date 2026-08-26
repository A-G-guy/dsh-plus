/**
 * 浏览器半的 host 接收面：/dsh-plus/reload 下四个端点。
 * 暴露面与 GUI 其余部分同级（webserver 默认 loopback）；一次性 token +
 * 两阶段确认构成防误触/防重放边界，不另设鉴权。
 * handler 工厂与路由注册分离，测试直接驱动 handler（禁起真实服务器）。
 * @module reload/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { ReloadConfig } from './config.ts'
import { type PreflightResult, type Runner, runPreflight, systemRunner } from './preflight.ts'
import type { ReloadScheduler } from './scheduler.ts'

const ROUTE = '/dsh-plus/reload'

export interface RouteDeps {
  scheduler: ReloadScheduler
  config: ReloadConfig
  pid?: number
  runner?: Runner
  runningAgents?: () => number
  onError?: (message: string) => void
}

export interface PrepareResponse {
  token: string
  expiresAt: number
  bootId: string
  runningAgents: number
  countdownSeconds: number
  pollTimeoutMs: number
  preflight: PreflightResult
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
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

/** 组装请求处理器；env/runner/runningAgents 均可注入，测试零真实副作用。 */
export function createReloadHandler(
  deps: RouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { scheduler, config } = deps
  const pid = deps.pid ?? process.pid
  const runner = deps.runner ?? systemRunner
  const runningAgents = deps.runningAgents ?? (() => 0)

  const handleHealth = (res: ServerResponse): void => {
    sendJson(res, 200, {
      ok: true,
      bootId: scheduler.bootId,
      watchdogIntervalMs: config.watchdogIntervalSeconds * 1000,
    })
  }

  const handlePrepare = async (res: ServerResponse): Promise<void> => {
    const preflight = await runPreflight(config.unitName, pid, runner)
    if (!preflight.ok) {
      sendJson(res, 409, { error: 'preflight failed', preflight })
      return
    }
    const { token, expiresAt } = scheduler.prepare()
    const body: PrepareResponse = {
      token,
      expiresAt,
      bootId: scheduler.bootId,
      runningAgents: runningAgents(),
      countdownSeconds: config.clientCountdownSeconds,
      pollTimeoutMs: config.clientPollTimeoutMs,
      preflight,
    }
    sendJson(res, 200, body)
  }

  const handleConfirm = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson(req)
    if (!body) {
      sendJson(res, 400, { error: 'invalid json body' })
      return
    }
    const result = scheduler.confirm(body.token, {
      force: body.force === true,
      runningAgents: runningAgents(),
    })
    if (result.kind === 'invalid-token') sendJson(res, 403, { error: 'invalid or expired token' })
    else if (result.kind === 'agents-running')
      sendJson(res, 409, {
        error: 'agents running',
        runningAgents: result.count,
      })
    else
      sendJson(res, 200, {
        ok: true,
        etaMs: result.etaMs,
        bootId: scheduler.bootId,
      })
  }

  const handleCancel = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson(req)
    if (!body) {
      sendJson(res, 400, { error: 'invalid json body' })
      return
    }
    sendJson(res, scheduler.cancel(body.token) ? 200 : 404, {
      ok: scheduler.getState() === 'idle',
    })
  }

  return async (req, res) => {
    try {
      const sub = new URL(req.url ?? '/', 'http://localhost').pathname.slice(ROUTE.length)
      const method = req.method ?? 'GET'
      if (sub === '/health') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'GET only' })
        return handleHealth(res)
      }
      if (sub === '/prepare' || sub === '/confirm' || sub === '/cancel') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
        if (sub === '/prepare') return await handlePrepare(res)
        if (sub === '/confirm') return await handleConfirm(req, res)
        return await handleCancel(req, res)
      }
      sendJson(res, 404, { error: 'unknown endpoint' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.onError?.(`reload api failed: ${message}`)
      if (!res.headersSent) sendJson(res, 500, { error: message })
      else res.end()
    }
  }
}

/** 注册路由（webServer 缺失时由调用方保证不调用）。 */
export function registerReloadRoutes(ctx: Context, deps: RouteDeps): void {
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: createReloadHandler(deps),
  })
}
