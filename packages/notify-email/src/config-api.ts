/**
 * 配置 HTTP 通道：webui 插件配置卡片的后端。
 * 背景：官方 apiproxy 的 settings.* RPC 对 namespace 有硬编码白名单，第三方
 * namespace 一律 settings-not-exposed；故卡片数据走自建 webServer 路由，
 * 读写仍经 ctx.settings 用户层（持久化 $DSH_HOME/settings.yaml）。
 * 仅监听 dsh web 同源（webserver 默认 127.0.0.1），与 GUI 其余面同等暴露面。
 * @module notify-email/config-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'

import { SETTINGS_NS, toUserPatch, toWire, WirePatch, type WirePatchInput } from './config.ts'
import type { NotifyEmailService } from './service.ts'

const ROUTE_CONFIG = '/dsh-plus/notify-email/config'
const ROUTE_TEST = '/dsh-plus/notify-email/test'
const MAX_BODY_BYTES = 64 * 1024

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

async function handleConfig(
  ctx: Context,
  service: NotifyEmailService,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const settings = ctx.get('settings')
  if (req.method === 'GET') {
    sendJson(res, 200, toWire(service.currentConfig(), settings !== undefined))
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
  const patch = toUserPatch(await readPatch(req))
  await settings.update(SETTINGS_NS, patch)
  sendJson(res, 200, toWire(service.currentConfig(), true))
}

async function handleTest(service: NotifyEmailService, res: ServerResponse): Promise<void> {
  const result = await service.sendTest()
  sendJson(res, result.ok ? 200 : 502, result)
}

/** 注册配置读写与测试发信路由；返回是否注册成功（webServer 缺失时由调用方保证不调用）。 */
export function registerConfigApi(ctx: Context, service: NotifyEmailService): void {
  const logger = ctx.logger('notify-email')
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
    path: ROUTE_TEST,
    handler: guard(async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      await handleTest(service, res)
    }),
  })
}
