/**
 * 配置 HTTP 通道：webui 插件配置卡片的后端。
 * 背景：官方 apiproxy 的 settings.* RPC 对 namespace 有硬编码白名单，第三方
 * namespace 一律 settings-not-exposed；故卡片数据走自建 webServer 路由，
 * 读写仍经 ctx.settings 用户层（持久化 $DSH_HOME/settings.yaml）。
 * 仅监听 dsh web 同源（webserver 默认 127.0.0.1），与 GUI 其余面同等暴露面。
 * @module subagent-model/config-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'

import { buildModelCatalog, type ModelCatalog } from './catalog.ts'
import {
  SETTINGS_NS, toUserPatch, toWire, validateEntry, WirePatch, type WirePatchOutput,
} from './config.ts'
import type { SubagentModelService } from './service.ts'

const ROUTE_CONFIG = '/dsh-custom/subagent-model/config'
const ROUTE_CATALOG = '/dsh-custom/subagent-model/catalog'
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

async function readPatch(req: IncomingMessage): Promise<WirePatchOutput> {
  const raw = await readBody(req)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('request body is not valid JSON')
  }
  return WirePatch(parsed)
}

/** 校验用户提交的 entries（model 不能脱离 provider 等）；返回首个错误消息或 null。 */
function firstEntryError(patch: WirePatchOutput): string | null {
  for (const [name, entry] of Object.entries(patch.entries)) {
    const error = validateEntry(entry)
    if (error !== null) return `条目 ${name}: ${error}`
  }
  return null
}

async function handleConfig(
  ctx: Context,
  service: SubagentModelService,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const settings = ctx.get('settings')
  if (req.method === 'GET') {
    sendJson(res, 200, toWire(service.currentConfig(), service.subagentProviders(), settings !== undefined))
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
  const entryError = firstEntryError(patch)
  if (entryError !== null) {
    sendJson(res, 400, { error: entryError })
    return
  }
  await settings.update(SETTINGS_NS, toUserPatch(patch))
  sendJson(res, 200, toWire(service.currentConfig(), service.subagentProviders(), true))
}

async function handleCatalog(ctx: Context, res: ServerResponse): Promise<void> {
  const catalog: ModelCatalog = await buildModelCatalog(ctx)
  sendJson(res, 200, catalog)
}

/** 注册配置读写与目录路由；返回是否注册成功（webServer 缺失时由调用方保证不调用）。 */
export function registerConfigApi(ctx: Context, service: SubagentModelService): void {
  const logger = ctx.logger('subagent-model')
  const guard = (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) => {
    return async (req, res) => {
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
    handler: guard((req, res) => handleConfig(ctx, service, req, res)),
  })
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
