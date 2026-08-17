/**
 * 配置 HTTP 通道：webui 配置卡片的后端（notify-email 同款模式）。
 * 背景：官方 apiproxy 的 settings.* RPC 对 namespace 有硬编码白名单，第三方
 * namespace 一律 settings-not-exposed；卡片数据走自建 webServer 同源路由，
 * 写回经 ctx.settings.replace 整段覆盖用户层（providers dict 的删除语义
 * 无法经深合并表达）。写入先过 settings 校验钩子（完整解析试跑），
 * 非法配置在写入处拒绝并返回错误明细。
 * @module llm-pi/config-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'

import { builtinModelIds } from './catalog/builtin.ts'
import { SETTINGS_NS, toWire, WirePatch, type WirePatchInput } from './config.ts'
import type { LlmPiRuntime } from './service.ts'

const ROUTE_CONFIG = '/dsh-custom/llm-pi/config'
const ROUTE_CATALOG = '/dsh-custom/llm-pi/catalog'
const MAX_BODY_BYTES = 256 * 1024

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readPatch(req: IncomingMessage): Promise<WirePatchInput> {
  const raw = await readBody(req)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('request body is not valid JSON')
  }
  return WirePatch(parsed) as WirePatchInput
}

function wireOf(runtime: LlmPiRuntime, writable: boolean) {
  // 状态始终上报（含未拉取/失败），由卡片区分文案；不再用 enabled 做 null 开关。
  return toWire(runtime.currentConfig(), writable, runtime.kitInfo().source, runtime.modelsDev.status())
}

async function handleConfig(
  ctx: Context,
  runtime: LlmPiRuntime,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const settings = ctx.get('settings')
  if (req.method === 'GET') {
    sendJson(res, 200, wireOf(runtime, settings !== undefined))
    return
  }
  if (req.method !== 'PUT') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  if (settings === undefined) {
    sendJson(res, 503, { error: 'settings provider 不可用，无法在线保存；请编辑 settings.yaml' })
    return
  }
  const patch = await readPatch(req)
  await settings.replace(SETTINGS_NS, patch)
  sendJson(res, 200, wireOf(runtime, true))
}

/** 目录查询/手动拉取：GET ?provider=&source= → 该源模型 id 列表；POST /refresh → 立即拉取。 */
function handleCatalog(runtime: LlmPiRuntime, req: IncomingMessage, res: ServerResponse): void {
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
    })
    return
  }
  sendJson(res, 200, {
    providers: runtime.kit.getBuiltinProviders(),
    models: provider.length > 0 ? builtinModelIds(runtime.kit, provider) : [],
  })
}

/** 注册配置读写与目录查询路由（webServer 缺失时由调用方保证不调用）。 */
export function registerConfigApi(ctx: Context, runtime: LlmPiRuntime): void {
  const logger = ctx.logger('llm-pi')
  const guard = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) => {
    return async (req: IncomingMessage, res: ServerResponse) => {
      try {
        await handler(req, res)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`config api ${req.method ?? '?'} ${req.url ?? '?'} failed: ${message}`)
        if (!res.headersSent) sendJson(res, 400, { error: message })
        else res.end()
      }
    }
  }
  ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_CONFIG,
    handler: guard((req, res) => handleConfig(ctx, runtime, req, res)),
  })
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_CATALOG,
    handler: guard((req, res) => handleCatalog(runtime, req, res)),
  })
}
