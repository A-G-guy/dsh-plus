/**
 * 哨兵回报的 host 接收面：POST /dsh-plus/lifeboat/quarantine {name}
 * 仅监听 dsh web 同源（webserver 默认 127.0.0.1），与 GUI 其余面同等暴露面。
 * @module lifeboat/quarantine-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { Quarantine } from './quarantine.ts'

const ROUTE = '/dsh-plus/lifeboat/quarantine'

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

/** 注册哨兵回报路由（webServer 缺失时由调用方保证不调用）。 */
export function registerQuarantineApi(ctx: Context, q: Quarantine): void {
  const logger = ctx.logger('lifeboat')
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST only' })
          return
        }
        const body = JSON.parse(await readBody(req)) as { name?: unknown }
        if (typeof body.name !== 'string') {
          sendJson(res, 400, { error: 'missing name' })
          return
        }
        void q.quarantine(body.name, 'client')
        sendJson(res, 200, { ok: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`quarantine api failed: ${message}`)
        if (!res.headersSent) sendJson(res, 400, { error: message })
        else res.end()
      }
    },
  })
}
