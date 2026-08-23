/**
 * HTTP 路由层：`/dsh-plus/web-files` 前缀下的 JSON/流式端点。
 * 只做方法/载荷解析与错误映射，文件语义全部在 fs-core。
 *
 * 安全接缝：`web-files/access` 事件（serial）在每个请求进入处理器前发出，
 * 任何监听器抛错即 403。本插件不做鉴权，统一围栏留给后续安全插件。
 * @module @dsh-plus/web-files/files-api
 */
import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import {
  deleteEntry,
  FilesError,
  listDirectory,
  makeDirectory,
  readFileText,
  renameEntry,
  saveUpload,
  statDownload,
  writeFileText,
} from './fs-core.ts'
import type {
  ApiErrorBody,
  DeleteRequest,
  ListRequest,
  MkdirRequest,
  ReadRequest,
  RenameRequest,
  WriteRequest,
} from './protocol.ts'
import { ROUTE_PREFIX } from './protocol.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * 文件 API 访问接缝（serial）：监听器抛错即拒绝该请求（403）。
     * 供未来的统一安全插件实现鉴权/路径围栏。
     * @param info - 方法、端点与目标路径（download/upload 经 query 解析后）。
     */
    'web-files/access'(info: { method: string; endpoint: string; path?: string }): void
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof FilesError) {
    const body: ApiErrorBody = { error: error.message, code: error.code }
    sendJson(res, error.status, body)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, 500, { error: message } satisfies ApiErrorBody)
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {} as T
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new FilesError('request body must be valid JSON', 'path-invalid')
  }
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

/** 统一守卫：访问接缝 + 方法校验 + 错误映射 + 上下文日志。 */
function wrap(ctx: Context, endpoint: string, method: 'GET' | 'POST', handler: Handler): Handler {
  const logger = ctx.logger('web-files')
  return async (req, res, url) => {
    try {
      if (req.method !== method) {
        sendJson(res, 405, { error: 'method not allowed' } satisfies ApiErrorBody)
        return
      }
      await ctx.serial('web-files/access', {
        method,
        endpoint,
        path: url.searchParams.get('path') ?? url.searchParams.get('dir') ?? undefined,
      })
      await handler(req, res, url)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`files api ${endpoint} failed: ${message}`)
      if (!res.headersSent) sendError(res, error)
      else res.end()
    }
  }
}

/** Content-Disposition 文件名：ASCII 直出，非 ASCII 走 RFC 5987 filename*。 */
function contentDisposition(filename: string): string {
  const ascii = /^[\x20-\x7e]*$/.test(filename) ? filename.replaceAll('"', "'") : 'download'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** 端点表：路径段 → 处理器。 */
function buildHandlers(ctx: Context): Record<string, Handler> {
  return {
    '/list': wrap(ctx, '/list', 'POST', async (req, res) => {
      const body = await readJsonBody<ListRequest>(req)
      sendJson(res, 200, await listDirectory(body.path, body.showHidden === true))
    }),
    '/read': wrap(ctx, '/read', 'POST', async (req, res) => {
      const body = await readJsonBody<ReadRequest>(req)
      sendJson(res, 200, await readFileText(body.path))
    }),
    '/write': wrap(ctx, '/write', 'POST', async (req, res) => {
      const body = await readJsonBody<WriteRequest>(req)
      sendJson(res, 200, await writeFileText(body.path, body.content, body.baseMtimeMs))
    }),
    '/mkdir': wrap(ctx, '/mkdir', 'POST', async (req, res) => {
      const body = await readJsonBody<MkdirRequest>(req)
      sendJson(res, 200, await makeDirectory(body.parent, body.name))
    }),
    '/rename': wrap(ctx, '/rename', 'POST', async (req, res) => {
      const body = await readJsonBody<RenameRequest>(req)
      sendJson(res, 200, await renameEntry(body.path, body.newName))
    }),
    '/delete': wrap(ctx, '/delete', 'POST', async (req, res) => {
      const body = await readJsonBody<DeleteRequest>(req)
      sendJson(res, 200, await deleteEntry(body.path))
    }),
    '/upload': wrap(ctx, '/upload', 'POST', async (req, res, url) => {
      const dir = url.searchParams.get('dir') ?? ''
      const name = url.searchParams.get('name') ?? ''
      sendJson(res, 200, await saveUpload(dir, name, req))
    }),
    '/download': wrap(ctx, '/download', 'GET', async (_req, res, url) => {
      const info = await statDownload(url.searchParams.get('path') ?? '')
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(info.size),
        'content-disposition': contentDisposition(basename(info.path)),
      })
      await new Promise<void>((resolvePromise, rejectPromise) => {
        createReadStream(info.path)
          .pipe(res)
          .on('finish', resolvePromise)
          .on('error', rejectPromise)
      })
    }),
  }
}

/** 注册全部文件路由（webServer 缺失时由调用方保证不调用）。 */
export function registerFilesApi(ctx: Context): void {
  const handlers = buildHandlers(ctx)
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const endpoint = url.pathname.slice(ROUTE_PREFIX.length)
      const handler = handlers[endpoint]
      if (handler === undefined) {
        sendJson(res, 404, { error: `unknown endpoint: ${endpoint}` } satisfies ApiErrorBody)
        return
      }
      void handler(req, res, url)
    },
  })
}
