/**
 * 自定义端点 HTTP 通道：配置读写已迁移到官方 remote.settings 直连
 * （0.1.2-alpha.1 起第三方命名空间全量开放），这里只保留官方传输没有的
 * 「模型目录」端点（含 kitSource / models-dev 运行期诊断，供卡片状态行展示）。
 * 仅监听 dsh web 同源（webserver 默认 127.0.0.1），与 GUI 其余面同等暴露面。
 * @module llm-pi/config-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'

import { builtinModelIds } from './catalog/builtin.ts'
import type { LlmPiRuntime } from './service.ts'

const ROUTE_CATALOG = '/dsh-plus/llm-pi/catalog'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 目录查询/手动拉取：GET ?provider=&source= → 该源模型 id 列表；POST /refresh → 立即拉取。 */
function handleCatalog(runtime: LlmPiRuntime, req: IncomingMessage, res: ServerResponse): void {
  const kitSource = runtime.kitInfo().source
  if (req.method === 'POST' && req.url?.endsWith('/refresh')) {
    void runtime.modelsDev.refresh().then(() => {
      sendJson(res, 200, { status: runtime.modelsDev.status() })
    })
    return
  }
  const url = new URL(req.url ?? '', 'http://localhost')
  const provider = url.searchParams.get('provider') ?? ''
  const source = url.searchParams.get('source') ?? 'builtin'
  if (source === 'models-dev') {
    sendJson(res, 200, {
      providers: runtime.modelsDev.providerIds(),
      models: provider.length > 0 ? runtime.modelsDev.modelIds(provider) : [],
      status: runtime.modelsDev.status(),
      kitSource,
    })
    return
  }
  sendJson(res, 200, {
    providers: runtime.kit.getBuiltinProviders(),
    models: provider.length > 0 ? builtinModelIds(runtime.kit, provider) : [],
    kitSource,
  })
}

/** 注册目录路由（webServer 缺失时由调用方保证不调用）。 */
export function registerCatalogApi(ctx: Context, runtime: LlmPiRuntime): void {
  const logger = ctx.logger('llm-pi')
  const guard = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) => {
    return async (req: IncomingMessage, res: ServerResponse) => {
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
    kind: 'prefix',
    path: ROUTE_CATALOG,
    handler: guard((req, res) => handleCatalog(runtime, req, res)),
  })
}
