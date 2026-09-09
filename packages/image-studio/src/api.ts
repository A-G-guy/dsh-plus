/**
 * image-studio HTTP 端点（同源 webServer，与 usage-panel 同一暴露面约定）：
 * - POST generate / GET tasks|tasks/<id> / POST tasks/<id>/cancel
 * - GET gallery|gallery/<id> / DELETE gallery/<id> / GET images/<id>
 * - GET|POST|DELETE credentials（describe/set/unset，值永不回传）
 * - GET providers（协议 registry + 参数目录，前端表单依据）
 * @module image-studio/api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { GenerateRequest } from './dto.ts'
import { ImageStudioError, statusOfCode } from './errors.ts'
import { PARAM_CATALOG } from './params/catalog.ts'
import { ParamValidationError } from './params/spec.ts'
import { listProtocols } from './provider/registry.ts'
import type { ImageStudioService } from './service.ts'

const ROUTE_PREFIX = '/dsh-plus/image-studio'

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

/** 统一错误结算：ImageStudioError/ParamValidationError 按码映射，其余 500。 */
function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ImageStudioError) {
    sendJson(res, statusOfCode(error.code), { error: error.code, message: error.message })
    return
  }
  if (error instanceof ParamValidationError) {
    sendJson(res, 400, { error: 'invalid-request', message: error.message })
    return
  }
  sendJson(res, 500, {
    error: 'internal',
    message: error instanceof Error ? error.message : String(error),
  })
}

/** 端点处理函数表（path 段 → handler）。 */
type Handler = (req: IncomingMessage, res: ServerResponse, rest: string) => Promise<void>

function buildHandlers(service: ImageStudioService): Record<string, Handler> {
  return {
    async generate(_req, res, rest) {
      if (rest !== '') throw new ImageStudioError('invalid-request', '未知路径')
      if (method(_req) !== 'POST') {
        sendJson(res, 405, { error: 'POST only' })
        return
      }
      const body = JSON.parse(await readBody(_req)) as GenerateRequest
      const taskId = await service.submitGenerate(body)
      sendJson(res, 202, { taskId })
    },
    async tasks(_req, res, rest) {
      // /tasks 与 /tasks/<id> 与 /tasks/<id>/cancel
      if (rest === '') {
        sendJson(res, 200, { tasks: service.taskWires() })
        return
      }
      const [taskId, action] = rest.split('/')
      if (taskId === undefined || taskId.length === 0) {
        throw new ImageStudioError('invalid-request', '缺少任务 id')
      }
      if (action === 'cancel') {
        if (method(_req) !== 'POST') {
          sendJson(res, 405, { error: 'POST only' })
          return
        }
        const ok = service.cancelTask(taskId)
        sendJson(res, ok ? 200 : 409, ok ? { ok: true } : { error: 'task-not-runnable' })
        return
      }
      if (action !== undefined) throw new ImageStudioError('invalid-request', `未知操作：${action}`)
      const wire = service.taskWire(taskId)
      if (wire === null) throw new ImageStudioError('unknown-task', `任务不存在：${taskId}`)
      sendJson(res, 200, wire)
    },
    async gallery(_req, res, rest) {
      const [itemId] = rest.split('/')
      if (itemId === undefined || itemId === '') {
        if (method(_req) !== 'GET') {
          sendJson(res, 405, { error: 'GET only' })
          return
        }
        const items = await service.gallery()
        sendJson(res, 200, { items, total: items.length })
        return
      }
      if (itemId === 'credentials' || itemId === 'providers') return
      if (method(_req) === 'DELETE') {
        const removed = await service.deleteGalleryItem(itemId)
        sendJson(res, removed ? 200 : 404, removed ? { ok: true } : { error: 'not-found' })
        return
      }
      if (method(_req) !== 'GET') {
        sendJson(res, 405, { error: 'GET or DELETE only' })
        return
      }
      const items = await service.gallery()
      const item = items.find((entry) => entry.id === itemId)
      if (item === undefined) {
        sendJson(res, 404, { error: 'not-found' })
        return
      }
      sendJson(res, 200, item)
    },
    async images(_req, res, rest) {
      const imageId = rest.replace(/\/$/, '')
      if (imageId.length === 0 || imageId.includes('/')) {
        sendJson(res, 404, { error: 'not-found' })
        return
      }
      const bytes = await service.imageBytes(imageId)
      if (bytes === null) {
        sendJson(res, 404, { error: 'not-found' })
        return
      }
      const mime = bytes.ext === 'jpg' ? 'image/jpeg' : `image/${bytes.ext}`
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'private, max-age=3600' })
      res.end(Buffer.from(bytes.data))
    },
    async credentials(_req, res, rest) {
      const refName = rest.replace(/\/$/, '')
      if (refName.length === 0) {
        sendJson(res, 400, { error: 'invalid-request', message: '缺少凭据引用名' })
        return
      }
      if (method(_req) === 'GET') {
        sendJson(res, 200, await service.credentialStatus(refName))
        return
      }
      if (method(_req) === 'POST') {
        const body = JSON.parse(await readBody(_req)) as { value?: unknown }
        if (typeof body.value !== 'string' || body.value.length === 0) {
          sendJson(res, 400, { error: 'invalid-request', message: 'value 必须是非空字符串' })
          return
        }
        await service.setCredential(refName, body.value)
        sendJson(res, 200, { ok: true })
        return
      }
      if (method(_req) === 'DELETE') {
        await service.unsetCredential(refName)
        sendJson(res, 200, { ok: true })
        return
      }
      sendJson(res, 405, { error: 'GET/POST/DELETE only' })
    },
    async providers(_req, res, rest) {
      if (rest !== '' || method(_req) !== 'GET') {
        sendJson(res, rest !== '' ? 404 : 405, { error: 'GET /providers only' })
        return
      }
      sendJson(res, 200, {
        protocols: listProtocols(),
        params: PARAM_CATALOG,
      })
    },
    async presets(_req, res, rest) {
      // 预设读写走官方 settings RPC；本端点仅提供只读快照（懒人通道）。
      if (rest !== '' || method(_req) !== 'GET') {
        sendJson(res, 405, { error: 'GET /presets only' })
        return
      }
      sendJson(res, 200, service.presets())
    },
  }
}

/** 请求方法小写化。 */
function method(req: IncomingMessage): string {
  return (req.method ?? 'GET').toUpperCase()
}

/** 路由分发（prefix 单注册 + 内部分段）。 */
export function registerImageStudioApi(ctx: Context, service: ImageStudioService): void {
  const handlers = buildHandlers(service)
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const segments = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\//, '')
      const [head, ...tail] = segments.split('/')
      const rest = tail.join('/')
      void (async () => {
        if (head === undefined || head === '') {
          sendJson(res, 404, { error: 'unknown endpoint' })
          return
        }
        const handler = handlers[head]
        if (handler === undefined) {
          sendJson(res, 404, { error: `unknown endpoint: ${head}` })
          return
        }
        await handler(req, res, rest)
      })().catch((error: unknown) => sendError(res, error))
    },
  })
}
