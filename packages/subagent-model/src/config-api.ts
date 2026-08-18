/**
 * 自定义端点 HTTP 通道：配置读写已迁移到官方 settings RPC（rc7 起第三方
 * 命名空间全量开放），这里只保留官方传输没有的「模型目录」端点。
 * 仅监听 dsh web 同源（webserver 默认 127.0.0.1），与 GUI 其余面同等暴露面。
 * @module subagent-model/config-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'

import { buildModelCatalog, type ModelCatalog } from './catalog.ts'

const ROUTE_CATALOG = '/dsh-plus/subagent-model/catalog'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function handleCatalog(ctx: Context, res: ServerResponse): Promise<void> {
  const catalog: ModelCatalog = await buildModelCatalog(ctx)
  sendJson(res, 200, catalog)
}

/** 注册目录路由；返回是否注册成功（webServer 缺失时由调用方保证不调用）。 */
export function registerCatalogApi(ctx: Context): void {
  const logger = ctx.logger('subagent-model')
  const guard = (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) => {
    return async (req, res) => {
      try {
        await handler(req, res)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`catalog api ${req.method ?? '?'} ${req.url ?? '?'} failed: ${message}`)
        if (!res.headersSent) sendJson(res, 400, { error: message })
        else res.end()
      }
    }
  }
  ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_CATALOG,
    handler: guard(async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      await handleCatalog(ctx, res)
    }),
  })
}
