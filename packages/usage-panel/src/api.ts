/**
 * usage-panel HTTP 端点：GET data / GET|POST catalog / POST prices-import。
 * 与 dsh web 同源（webServer 默认 loopback / 反代信任域），无独立鉴权
 * （与 notify-email/lifeboat 自定义端点同一暴露面约定）。
 * @module usage-panel/api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { UsagePanelService } from './service.ts'
import type { UsageRow } from './usage-fold.ts'

const ROUTE_DATA = '/dsh-plus/usage-panel/data'
const ROUTE_CATALOG = '/dsh-plus/usage-panel/catalog'
const ROUTE_PRICES = '/dsh-plus/usage-panel/prices-import'

interface WireRow extends UsageRow {
  cost: number | null
}

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

/** 注册端点（webServer 缺席时由调用方保证不调用）。 */
export function registerUsageApi(ctx: Context, service: UsagePanelService): void {
  const logger = ctx.logger('usage-panel')
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_DATA,
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      try {
        const rows: WireRow[] = service.allRows().map((row) => ({
          ...row,
          cost: service.rowCost(row),
        }))
        const table = service.priceTable()
        sendJson(res, 200, {
          generatedAt: new Date().toISOString(),
          currency: table.currency,
          pricedCount: table.entries.length,
          sync: service.syncProgress(),
          catalog: service.catalogState(),
          sessions: service.sessionCount(),
          rows,
        })
      } catch (error) {
        logger.warn(
          `data endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        sendJson(res, 500, { error: 'internal' })
      }
    },
  })
  // 目录状态/手动刷新：GET 看状态（含 fetchedAt/error），POST 触发后台刷新（立即返回）。
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_CATALOG,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method === 'POST') {
          const catalog = service.catalogStore()
          if (catalog === null) {
            sendJson(res, 409, { error: 'catalog-unavailable' })
            return
          }
          void catalog.refresh()
          sendJson(res, 202, { ok: true })
          return
        }
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'GET or POST only' })
          return
        }
        sendJson(res, 200, service.catalogState())
      } catch (error) {
        logger.warn(
          `catalog endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        sendJson(res, 500, { error: 'internal' })
      }
    },
  })
  // 价目导入：请求体可带 doc（兼容外部来源），缺省用 host 端已缓存目录折算。
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PRICES,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST only' })
          return
        }
        const body = JSON.parse(await readBody(req)) as { doc?: unknown }
        if (body.doc !== undefined && typeof body.doc !== 'string') {
          sendJson(res, 400, { error: 'doc-required' })
          return
        }
        const imported = await service.importFromModelsDev(
          typeof body.doc === 'string' ? body.doc : null,
        )
        sendJson(res, 200, { imported })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`prices-import failed: ${message}`)
        if (message === 'catalog-unavailable' || message === 'settings-unavailable') {
          sendJson(res, 409, { error: message })
          return
        }
        sendJson(res, 500, { error: 'internal' })
      }
    },
  })
}
