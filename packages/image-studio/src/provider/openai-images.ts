/**
 * OpenAI Images API 适配器（首批协议实现）。
 * - 请求构造是纯函数（单测覆盖 JSON/multipart 两种形态）；
 * - 执行走 node:http(s)，https 目标代理经 https-proxy-agent（与 llm-pi 同约定）；
 * - 响应统一取回字节（url → 下载 / b64_json → 解码），调用方零二次请求。
 * 开发测试指向本地 mock，严禁真实调用产生费用。
 * @module image-studio/provider/openai-images
 */
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { GeneratedImage, InputImage, NormalizedRequest, ProviderResult } from './types.ts'
import { ProviderError } from './types.ts'

/** 顶层响应体上限（4K PNG 约 10-20MB，放宽到 64MB 防滥用）。 */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

const MIME_BY_FORMAT: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** output_format 参数值 → MIME（b64 结果无 content-type 时兜底）。 */
export function mimeOfFormat(format: unknown): string {
  return MIME_BY_FORMAT[format as string] ?? 'image/png'
}

/** 官方端点路径。 */
export function endpointPath(endpoint: NormalizedRequest['endpoint']): string {
  return endpoint === 'generation' ? '/images/generations' : '/images/edits'
}

interface HeaderLike {
  [key: string]: string
}

/** 公共请求头（鉴权 + 用户附加头）。 */
function baseHeaders(apiKey: string, extra?: Record<string, string>): HeaderLike {
  return { authorization: `Bearer ${apiKey}`, ...extra }
}

/** multipart 文本字段分片。 */
function formField(name: string, value: string): string {
  return `--BOUNDARY\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
}

/** multipart 文件分片头。 */
function formFileHead(name: string, index: number, file: InputImage): string {
  const ext = file.mime.split('/')[1] ?? 'png'
  return (
    `--BOUNDARY\r\ncontent-disposition: form-data; name="${name}"; filename="${name}-${index}.${ext}"\r\n` +
    `content-type: ${file.mime}\r\n\r\n`
  )
}

/**
 * 构造 generations JSON 请求体（纯函数；params 已由 spec 层裁剪）。
 * model 是请求基础（target 承载，spec 层剥离），必须由本适配器拼回请求体：
 * 缺省时上游（one-api 系）会落到默认模型 dall-e → 503 model_not_found。
 */
export function buildGenerationBody(request: NormalizedRequest): string {
  return JSON.stringify({
    model: request.target.model,
    prompt: request.prompt,
    n: request.n,
    ...request.params,
  })
}

/** 构造 edits multipart 请求体（纯函数；image 官方上限 ≤16 张由边界校验）。 */
export function buildEditBody(request: NormalizedRequest): {
  headers: HeaderLike
  body: Buffer
} {
  const chunks: Buffer[] = []
  const pushText = (text: string): void => {
    chunks.push(Buffer.from(text, 'utf8'))
  }
  pushText(formField('model', request.target.model))
  pushText(formField('prompt', request.prompt))
  pushText(formField('n', String(request.n)))
  for (const [key, value] of Object.entries(request.params)) {
    pushText(formField(key, String(value)))
  }
  request.images.forEach((file, index) => {
    pushText(formFileHead('image', index, file))
    chunks.push(Buffer.from(file.data), Buffer.from('\r\n', 'utf8'))
  })
  if (request.mask !== null) {
    pushText(formFileHead('mask', 0, request.mask))
    chunks.push(Buffer.from(request.mask.data), Buffer.from('\r\n', 'utf8'))
  }
  chunks.push(Buffer.from('--BOUNDARY--\r\n', 'utf8'))
  return {
    headers: { 'content-type': 'multipart/form-data; boundary=BOUNDARY' },
    body: Buffer.concat(chunks),
  }
}

interface RawReply {
  status: number
  contentType: string
  body: Buffer
}

interface ExecOptions {
  method: 'POST' | 'GET'
  headers: HeaderLike
  body?: Buffer
  proxy: string
  timeoutMs: number
  signal: AbortSignal
}

/** 收集响应体（带字节上限；流错误结算防悬挂）。 */
function collect(
  req: import('node:http').ClientRequest,
  response: IncomingMessage,
  done: (reply: RawReply) => void,
  fail: (error: Error) => void,
): void {
  const chunks: Buffer[] = []
  let size = 0
  response.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size <= MAX_RESPONSE_BYTES) {
      chunks.push(chunk)
      return
    }
    response.destroy(new Error('响应超过 64MB 上限'))
  })
  response.on('end', () =>
    done({
      status: response.statusCode ?? 0,
      contentType: response.headers['content-type']?.split(';')[0] ?? '',
      body: Buffer.concat(chunks),
    }),
  )
  // 响应流自身出错不经请求转发：缺此监听 Promise 永不 settle。
  response.on('error', fail)
  req.on('error', fail)
}

/** HTTP(S) POST/GET 执行：代理 + 超时 + AbortSignal 贯穿。 */
function execRequest(url: string, options: ExecOptions): Promise<RawReply> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const doRequest = target.protocol === 'https:' ? httpsRequest : httpRequest
    const agent =
      target.protocol === 'https:' && options.proxy.length > 0
        ? new HttpsProxyAgent(options.proxy)
        : undefined
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const done = (reply: RawReply): void => {
      if (settled) return
      settled = true
      resolve(reply)
    }
    const req = doRequest(
      url,
      {
        method: options.method,
        headers: options.headers,
        timeout: options.timeoutMs,
        agent,
        signal: options.signal,
      },
      (response) => collect(req, response, done, fail),
    )
    req.on('timeout', () => req.destroy(new Error(`请求超时（${options.timeoutMs}ms）`)))
    req.on('error', fail)
    req.end(options.body ?? Buffer.alloc(0))
  })
}

/** 上游 Images API 响应的最小投影。 */
interface ImagesReply {
  created?: number
  data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> | null
}

/** url 形式结果图下载（同代理/超时策略；MIME 取响应头）。 */
async function fetchImageBytes(
  url: string,
  proxy: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ data: Uint8Array; mime: string }> {
  const reply = await execRequest(url, { method: 'GET', headers: {}, proxy, timeoutMs, signal })
  if (reply.status !== 200) {
    throw new ProviderError(reply.status, '', `结果图下载失败（HTTP ${reply.status}）`)
  }
  return { data: new Uint8Array(reply.body), mime: reply.contentType || 'image/png' }
}

/** 解析响应体为结果图列表（url 下载 / b64 解码统一为字节）。 */
async function parseImagesReply(
  bodyText: string,
  fallbackMime: string,
  proxy: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ProviderResult> {
  let doc: ImagesReply
  try {
    doc = JSON.parse(bodyText) as ImagesReply
  } catch {
    // 空 body/非 JSON：多为网关对错误路径返回 200 空体（如 baseUrl 缺 /v1）。
    const hint =
      bodyText.trim().length === 0
        ? '上游返回 200 空响应：请检查 baseUrl 是否包含 /v1'
        : '上游响应不是合法 JSON'
    throw new ProviderError(502, bodyText.slice(0, 500), hint)
  }
  const images: GeneratedImage[] = []
  for (const item of doc.data ?? []) {
    if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
      images.push({
        data: new Uint8Array(Buffer.from(item.b64_json, 'base64')),
        mime: fallbackMime,
        revisedPrompt: item.revised_prompt ?? null,
      })
      continue
    }
    if (typeof item.url === 'string' && item.url.length > 0) {
      const fetched = await fetchImageBytes(item.url, proxy, timeoutMs, signal)
      images.push({ ...fetched, revisedPrompt: item.revised_prompt ?? null })
    }
  }
  if (images.length === 0)
    throw new ProviderError(502, bodyText.slice(0, 500), '上游未返回任何图片')
  return { images, createdAt: typeof doc.created === 'number' ? doc.created : null }
}

/** 从上游错误响应提取可读摘要（JSON error.message / error 字符串 / 原始截断）。 */
function upstreamErrorMessage(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return '上游返回空响应'
  try {
    const doc = JSON.parse(trimmed) as {
      error?: { message?: string } | string
      message?: string
    }
    if (typeof doc.error === 'string' && doc.error.length > 0) return doc.error
    // error 是 string | { message? } 联合：先收窄到对象再读 message（直接访问不合法）。
    if (typeof doc.error === 'object' && doc.error !== null) {
      const message = doc.error.message
      if (typeof message === 'string' && message.length > 0) return message
    }
    if (typeof doc.message === 'string' && doc.message.length > 0) return doc.message
  } catch {
    // 非 JSON 响应（网关错误页等）：退回原始截断。
  }
  return trimmed.slice(0, 300)
}

/** 适配器主入口：构造请求 → 执行 → 解析。 */
export async function generateViaOpenAIImages(
  request: NormalizedRequest,
  signal: AbortSignal,
): Promise<ProviderResult> {
  const { target } = request
  const url = `${target.baseUrl.replace(/\/+$/, '')}${endpointPath(request.endpoint)}`
  const fallbackMime = mimeOfFormat(request.params.output_format)
  const reply =
    request.endpoint === 'generation'
      ? await execRequest(url, {
          method: 'POST',
          headers: {
            ...baseHeaders(target.apiKey, target.extraHeaders),
            'content-type': 'application/json',
          },
          body: Buffer.from(buildGenerationBody(request), 'utf8'),
          proxy: target.proxy,
          timeoutMs: target.timeoutMs,
          signal,
        })
      : await execRequest(url, {
          method: 'POST',
          headers: baseHeaders(target.apiKey, {
            ...target.extraHeaders,
            ...buildEditBody(request).headers,
          }),
          body: buildEditBody(request).body,
          proxy: target.proxy,
          timeoutMs: target.timeoutMs,
          signal,
        })
  if (reply.status !== 200) {
    const raw = reply.body.toString('utf8').slice(0, 2000)
    throw new ProviderError(
      reply.status,
      raw,
      `上游返回 HTTP ${reply.status}：${upstreamErrorMessage(raw)}`,
    )
  }
  return parseImagesReply(
    reply.body.toString('utf8'),
    fallbackMime,
    target.proxy,
    target.timeoutMs,
    signal,
  )
}
