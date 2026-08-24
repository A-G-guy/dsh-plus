/**
 * usage-panel HTTP 端点：GET data / POST scan / POST prices-import。
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
const ROUTE_SCAN = '/dsh-plus/usage-panel/scan'
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
          scanning: service.scanState(),
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
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_SCAN,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST only' })
          return
        }
        const result = await service.startScan()
        sendJson(res, result.ok ? 200 : 409, result)
      } catch (error) {
        logger.warn(
          `scan endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        sendJson(res, 500, { error: 'internal' })
      }
    },
  })
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
        if (typeof body.doc !== 'string') {
          sendJson(res, 400, { error: 'doc-required' })
          return
        }
        const settings = (
          ctx as unknown as {
            settings: {
              get(ns: string): unknown
              update(ns: string, patch: Record<string, unknown>): Promise<void>
            }
          }
        ).settings
        const current = settings.get('dsh-plus-usage-panel') as { prices?: unknown[] } | undefined
        const imported = await service.importFromModelsDev(body.doc, async (entries) => {
          await settings.update('dsh-plus-usage-panel', {
            prices: entries,
            ...(current === undefined || typeof current !== 'object' ? {} : {}),
          })
        })
        sendJson(res, 200, { imported })
      } catch (error) {
        logger.warn(
          `prices-import failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        sendJson(res, 500, { error: 'internal' })
      }
    },
  })
}
