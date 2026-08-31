/**
 * secret-env HTTP 端点：GET list / POST global.set / global.unset / session.set / session.unset。
 * 与 dsh web 同源（webServer 默认 loopback / 反代信任域），无独立鉴权
 * （与 usage-panel/notify-email 自定义端点同一暴露面约定）。
 * 值只在「浏览器 → 本端点 → 服务」链路出现，响应永不回显值。
 * @module secret-env/api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SecretEnvError } from './errors.ts'
import { normalizeSuffix, validateSuffix } from './names.ts'
import type { SecretEnvService } from './service.ts'

const ROUTE = '/dsh-plus/secret-env'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
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

/** 解析并校验请求里的变量名后缀；失败抛 SecretEnvError。 */
function readSuffix(raw: unknown): string {
  if (typeof raw !== 'string') throw new SecretEnvError('invalid-name', 'name must be a string')
  const suffix = normalizeSuffix(raw)
  const failure = validateSuffix(suffix)
  if (failure !== null) throw new SecretEnvError('invalid-name', `invalid name: ${failure}`)
  return suffix
}

function readString(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

/** 错误 → HTTP 映射（值类错误 400，遮蔽/冲突 409，其余 500；均只带错误码与消息）。 */
function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof SecretEnvError) {
    const status = error.code === 'shadowed' || error.code === 'conflict' ? 409 : 400
    sendJson(res, status, { ok: false, error: error.code, message: error.message })
    return
  }
  sendJson(res, 500, { ok: false, error: 'internal' })
}

/** 注册端点（webServer 缺席时由调用方保证不调用）。 */
export function registerSecretEnvApi(ctx: Context, service: SecretEnvService): void {
  const logger = ctx.logger('secret-env')
  const guard = (label: string, run: () => Promise<void>, res: ServerResponse): void => {
    run().catch((error: unknown) => {
      if (!(error instanceof SecretEnvError)) {
        logger.warn(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      sendError(res, error)
    })
  }

  ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE}/list`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') ?? undefined
      guard('list', async () => sendJson(res, 200, await service.list(sessionId)), res)
    },
  })

  ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE}/global/set`,
    handler: async (req, res) => {
      guard(
        'global/set',
        async () => {
          if (req.method !== 'POST') throw new SecretEnvError('method', 'POST only')
          const body = JSON.parse(await readBody(req)) as Record<string, unknown>
          await service.setGlobal(
            readSuffix(body.name),
            readString(body.value),
            readString(body.description),
          )
          sendJson(res, 200, { ok: true })
        },
        res,
      )
    },
  })

  ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE}/global/unset`,
    handler: async (req, res) => {
      guard(
        'global/unset',
        async () => {
          if (req.method !== 'POST') throw new SecretEnvError('method', 'POST only')
          const body = JSON.parse(await readBody(req)) as Record<string, unknown>
          await service.unsetGlobal(readSuffix(body.name))
          sendJson(res, 200, { ok: true })
        },
        res,
      )
    },
  })

  ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE}/session/set`,
    handler: async (req, res) => {
      guard(
        'session/set',
        async () => {
          if (req.method !== 'POST') throw new SecretEnvError('method', 'POST only')
          const body = JSON.parse(await readBody(req)) as Record<string, unknown>
          service.setSession(
            readString(body.sessionId),
            readSuffix(body.name),
            readString(body.value),
            readString(body.description),
            body.once === true,
          )
          sendJson(res, 200, { ok: true })
        },
        res,
      )
    },
  })

  ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE}/session/unset`,
    handler: async (req, res) => {
      guard(
        'session/unset',
        async () => {
          if (req.method !== 'POST') throw new SecretEnvError('method', 'POST only')
          const body = JSON.parse(await readBody(req)) as Record<string, unknown>
          service.unsetSession(readString(body.sessionId), readSuffix(body.name))
          sendJson(res, 200, { ok: true })
        },
        res,
      )
    },
  })
}
