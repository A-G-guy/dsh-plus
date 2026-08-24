/**
 * 浏览器半的 host 接收面：/dsh-plus/feature-toggle 下两个端点。
 * - GET /state：状态快照（期望态/生效状态/指针/journal/隔离集合）。
 * - POST /rebuild：重建托管预设（源预设升级漂移后的修复动作）。
 * 仅监听 dsh web 同源（webserver 默认 loopback），与 GUI 其余面同级暴露面。
 * @module feature-toggle/state-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { FeatureToggleEngine } from './engine.ts'

const ROUTE = '/dsh-plus/feature-toggle'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

/** 注册状态端点（webServer 缺席时由调用方保证不调用）。 */
export function registerStateApi(ctx: Context, engine: FeatureToggleEngine): void {
  const logger = ctx.logger('feature-toggle')
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (req, res) => {
      try {
        const method = req.method ?? 'GET'
        const path = (req.url ?? '').split('?')[0]
        if (method === 'GET' && path === `${ROUTE}/state`) {
          sendJson(res, 200, await engine.state())
          return
        }
        if (method === 'POST' && path === `${ROUTE}/rebuild`) {
          const body = await readBody(req)
          let sourcePresetId: string | undefined
          if (body.length > 0) {
            try {
              const parsed = JSON.parse(body) as { sourcePresetId?: unknown }
              if (typeof parsed.sourcePresetId === 'string') sourcePresetId = parsed.sourcePresetId
            } catch {
              sendJson(res, 400, { error: 'invalid JSON body' })
              return
            }
          }
          await engine.rebuildManagedPreset(sourcePresetId)
          sendJson(res, 200, { ok: true })
          return
        }
        sendJson(res, 404, { error: 'not found' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`state api ${req.method ?? '?'} ${req.url ?? '?'} failed: ${message}`)
        if (!res.headersSent) sendJson(res, 400, { error: message })
        else res.end()
      }
    },
  })
}
