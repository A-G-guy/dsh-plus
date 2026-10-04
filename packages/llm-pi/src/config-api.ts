/**
 * 自定义端点 HTTP 通道：配置读写走官方 remote.settings 直连
 * （0.1.2-alpha.1 起第三方命名空间全量开放），这里只提供浏览器半拿不到的两样东西：
 * - 运行期套件事实（生效版本、协议集合、目录规模、逐项降级诊断）；
 * - pi-ai 内置目录的搜索/筛选/分页（浏览器半读不到 pi-ai 包）。
 *
 * 两个端点同前缀、单次注册（按 pathname 分派，避免前缀互相遮蔽）：
 * - `GET  /dsh-plus/llm-pi/catalog`        运行期事实 + provider/协议索引 + compat 字段表；
 * - `GET  /dsh-plus/llm-pi/catalog/models` 目录搜索（q/provider/api/能力/分页）。
 * 仅监听 dsh web 同源（webserver 默认 127.0.0.1），与 GUI 其余面同等暴露面。
 * @module llm-pi/config-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import { browseModels } from './catalog/browse.ts'
import { compatFieldSpec, compatFieldsOf, compatProtocols, compatTableInfo } from './compat.ts'
import type { LlmPiRuntime } from './service.ts'

const ROUTE_CATALOG = '/dsh-plus/llm-pi/catalog'
const ROUTE_MODELS = `${ROUTE_CATALOG}/models`

/** 查询参数里的布尔开关：'1'/'true' 为真。 */
function boolParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback
  return value === '1' || value === 'true'
}

/** 查询参数里的整数；缺失/非法返回 undefined（由消费方取默认）。 */
function intParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * 服务端推导的 compat 字段表（协议 → 字段 → 取值约束）。浏览器半读不到官方包，
 * 由本端点下发，UI 渲染与服务端校验同源（不再各存一份手抄镜像表）。
 * 协议列表取运行期生效集合（不能服务的协议不渲染控件）；运行期列表为空时退回
 * 生效表自身的协议键，保证套件异常时表单仍可编辑。
 */
function compatTablePayload(protocols: readonly string[]): {
  fields: Record<string, Record<string, unknown>>
  source: string
  problem?: string
} {
  const list = protocols.length > 0 ? [...protocols] : compatProtocols()
  const fields: Record<string, Record<string, unknown>> = {}
  for (const api of list) {
    const perField: Record<string, unknown> = {}
    for (const field of compatFieldsOf(api)) {
      const spec = compatFieldSpec(api, field)
      if (spec !== undefined) perField[field] = spec
    }
    fields[api] = perField
  }
  const info = compatTableInfo()
  return info.problem === undefined
    ? { fields, source: info.source }
    : { fields, source: info.source, problem: info.problem }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 运行期事实 + 目录索引（卡片挂载时拉一次：版本、协议、目录规模、compat 字段表）。 */
function handleMeta(runtime: LlmPiRuntime, res: ServerResponse): void {
  const kit = runtime.kitInfo()
  sendJson(res, 200, {
    kit,
    providers: runtime.providerEntries(),
    apis: runtime.apiIndex(),
    compat: compatTablePayload(kit.protocols),
  })
}

/** 目录搜索：q（模糊）/provider/api/reasoning/image/servable/offset/limit。 */
function handleModels(runtime: LlmPiRuntime, url: URL, res: ServerResponse): void {
  const limit = intParam(url.searchParams.get('limit'))
  const result = browseModels(runtime.kit, {
    q: url.searchParams.get('q') ?? '',
    provider: url.searchParams.get('provider') ?? '',
    api: url.searchParams.get('api') ?? '',
    reasoning: boolParam(url.searchParams.get('reasoning'), false),
    image: boolParam(url.searchParams.get('image'), false),
    servableOnly: boolParam(url.searchParams.get('servable'), true),
    offset: intParam(url.searchParams.get('offset')) ?? 0,
    ...(limit === undefined ? {} : { limit }),
  })
  sendJson(res, 200, result)
}

/** 目录路由（webServer 缺失时由调用方保证不调用）。 */
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
    handler: guard((req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost')
      if (url.pathname === ROUTE_MODELS) {
        handleModels(runtime, url, res)
        return
      }
      if (url.pathname !== ROUTE_CATALOG) {
        sendJson(res, 404, { error: `未知端点 ${url.pathname}` })
        return
      }
      handleMeta(runtime, res)
    }),
  })
}
