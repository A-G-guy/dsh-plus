/**
 * image-studio HTTP 端点（同源 webServer，与 usage-panel 同一暴露面约定）：
 * - POST generate / GET tasks|tasks/<id> / POST tasks/<id>/cancel
 * - GET gallery|gallery/<id> / DELETE gallery/<id> / GET images/<id>
 * - POST uploads（本地文件上传原图）/ GET uploads|uploads/<id>（列表/缩略图流）
 * - GET|POST|DELETE credentials（describe/set/unset，值永不回传）
 * - GET providers（协议 registry + 参数目录，前端表单依据）
 * @module image-studio/api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { GenerateRequest } from './dto.ts'
import { ImageStudioError, statusOfCode } from './errors.ts'
import { detectImageMime, mimeOfExt } from './images/mime.ts'
import { UPLOAD_MAX_BYTES } from './limits.ts'
import { PARAM_CATALOG } from './params/catalog.ts'
import { ParamValidationError } from './params/spec.ts'
import { listProtocols } from './provider/registry.ts'
import type { ImageStudioService } from './service.ts'

const ROUTE_PREFIX = '/dsh-plus/image-studio'

/** 上传文件名长度上限（仅展示用途，超长截断）。 */
const UPLOAD_NAME_MAX = 200

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

/**
 * 读取二进制请求体（上传通道）：超限即中止并抛 upload-too-large。
 * 限额内的字节在内存中聚合（魔数嗅探需完整头部判定，单文件 ≤50MB；
 * 超限后不再累积，内存占用有界）。导出供单测用小限额直接驱动。
 */
export function readBinaryBody(
  req: IncomingMessage,
  maxBytes: number = UPLOAD_MAX_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        // 不 destroy：让调用方统一结束响应（后续 data 事件继续被丢弃）。
        reject(new ImageStudioError('upload-too-large', `文件超过 ${maxBytes} 字节上限`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
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
type Handler = (req: IncomingMessage, res: ServerResponse, rest: string, url: URL) => Promise<void>

/** 上传文件名（query 参数，仅展示用）：去控制字符并截断。 */
function uploadNameOf(url: URL): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 清洗用户文件名中的控制字符
  const raw = (url.searchParams.get('name') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (raw === '') return 'upload'
  return raw.slice(0, UPLOAD_NAME_MAX)
}

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
      const mime = mimeOfExt(bytes.ext)
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'private, max-age=3600' })
      res.end(Buffer.from(bytes.data))
    },
    async uploads(req, res, rest, url) {
      // POST /uploads（raw body 流，query 携带原文件名）；GET /uploads 列表；
      // GET /uploads/<id> 缩略图流（源图预览，与 images 同构）。
      const uploadId = rest.replace(/\/$/, '')
      if (method(req) === 'POST') {
        if (uploadId !== '') throw new ImageStudioError('invalid-request', '未知路径')
        const data = new Uint8Array(await readBinaryBody(req))
        // 魔数嗅探：不信任声明的 content-type，非白名单位图一律拒绝。
        const mime = detectImageMime(data)
        if (mime === null) {
          throw new ImageStudioError('unsupported-media', '只支持 PNG/JPEG/WebP/GIF 图片')
        }
        const entry = await service.saveUpload({
          name: uploadNameOf(url),
          mime,
          data,
        })
        sendJson(res, 201, entry)
        return
      }
      if (method(req) !== 'GET') {
        sendJson(res, 405, { error: 'GET or POST only' })
        return
      }
      if (uploadId === '') {
        const items = await service.listUploads()
        sendJson(res, 200, { items, total: items.length })
        return
      }
      const bytes = await service.uploadBytes(uploadId)
      if (bytes === null) {
        sendJson(res, 404, { error: 'not-found' })
        return
      }
      res.writeHead(200, {
        'content-type': mimeOfExt(bytes.ext),
        'cache-control': 'private, max-age=3600',
      })
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
        await handler(req, res, rest, url)
      })().catch((error: unknown) => sendError(res, error))
    },
  })
}
