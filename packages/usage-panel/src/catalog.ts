/**
 * models.dev 目录后台拉取（host 半）：后台定时/手动刷新公共静态 JSON，
 * 落盘缓存（`$DSH_HOME/usage-panel/models-dev.json`），任何失败沿用缓存，
 * 绝不阻塞插件加载或请求线程。纯折算在 models-dev.ts，本模块只管拉取与缓存。
 * 拉取经 node:http(s) 直连或 HTTP 代理（catalogProxy），带超时与响应体上限。
 * @module usage-panel/catalog
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { dirname } from 'node:path'
import type { Duplex } from 'node:stream'
import type { ConnectionOptions } from 'node:tls'

/** 目录文档最小投影（只关心形状，不解析字段）。 */
export type CatalogDocument = Record<string, unknown>

interface CacheFile {
  fetchedAt: string
  data: CatalogDocument
}

/** 拉取参数（全部外部化，测试可注入）。 */
export interface CatalogFetchOptions {
  url: string
  proxy: string
  timeoutMs: number
  maxBytes: number
}

/** 目录状态（端点投影）。 */
export interface CatalogStatus {
  fetchedAt: string | null
  error: string | null
  refreshing: boolean
}

interface JsonReply {
  status: number
  body: string
}

/**
 * 极简 JSON GET（node:http(s) 实现）：支持 HTTP 代理（仅 https 目标）与超时。
 * 不跟随重定向（models.dev 直链无重定向）；响应流错误也结算（防 Promise 悬挂）。
 */
export function fetchJsonVia(
  url: string,
  proxy: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<JsonReply> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const request = target.protocol === 'https:' ? httpsRequest : httpRequest
    // HTTP 代理对 https 目标走 CONNECT 隧道（https-proxy-agent 语义）；
    // 此处直接实现 CONNECT 过于复杂，改用与 llm-pi 一致的 http.request + agent。
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const done = (reply: JsonReply): void => {
      if (settled) return
      settled = true
      resolve(reply)
    }
    const send = (): void => {
      const req = request(
        url,
        { timeout: timeoutMs, headers: { accept: 'application/json' } },
        (response: IncomingMessage) => {
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > maxBytes) {
              req.destroy(new Error(`响应超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => {
            done({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
          })
          // 响应流自身出错不经请求转发：缺此监听时 Promise 永不 settle。
          response.on('error', fail)
        },
      )
      req.on('timeout', () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)))
      req.on('error', fail)
      req.end()
    }
    if (target.protocol === 'https:' && proxy.length > 0) {
      // CONNECT 隧道：经代理建立到目标的原始连接，再在其上发 https 请求。
      const [host, port] = proxy.replace(/^https?:\/\//, '').split(':')
      const tunnel = httpRequest({
        host: host || proxy,
        port: Number(port) || 80,
        method: 'CONNECT',
        path: `${target.hostname}:${target.port || 443}`,
        timeout: timeoutMs,
      })
      tunnel.on('connect', (res: IncomingMessage, socket: Duplex) => {
        if (res.statusCode !== 200) {
          socket.destroy()
          fail(new Error(`代理 CONNECT 失败（HTTP ${res.statusCode}）`))
          return
        }
        // 隧道建立：目标请求经同一 socket 发出（TLS 在隧道内协商）。
        // socket 是 tls.connect 的选项（https.request 建连时原样透传，已在本地
        // 实测经 CONNECT 隧道完成 TLS 请求）；@types/node 的 RequestOptions 未
        // 收录该字段，故与 tls.ConnectionOptions 求交补上，运行期行为不变。
        const tunnelOptions: RequestOptions & Pick<ConnectionOptions, 'socket'> = {
          socket,
          agent: false,
          timeout: timeoutMs,
          headers: { accept: 'application/json' },
          servername: target.hostname,
        }
        const req = httpsRequest(url, tunnelOptions, (response: IncomingMessage) => {
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > maxBytes) {
              req.destroy(new Error(`响应超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => {
            done({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          })
          response.on('error', fail)
        })
        req.on('timeout', () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)))
        req.on('error', fail)
        req.end()
      })
      tunnel.on('timeout', () => tunnel.destroy(new Error(`代理连接超时（${timeoutMs}ms）`)))
      tunnel.on('error', fail)
      tunnel.end()
      return
    }
    send()
  })
}

/**
 * models.dev 目录源：后台刷新（进行中幂等去重）+ 磁盘缓存 + 结构化状态。
 * 所有错误都被吞进状态（带日志回调），调用方永不 await 抛错。
 */
export class CatalogStore {
  private readonly cacheFile: string
  private options: CatalogFetchOptions
  private ttlHours: number
  private readonly log: (message: string) => void

  private document: CatalogDocument | null = null
  private fetchedAt: string | null = null
  private lastError: string | null = null
  private refreshing = false

  constructor(
    cacheFile: string,
    options: CatalogFetchOptions,
    ttlHours: number,
    log: (message: string) => void,
  ) {
    this.cacheFile = cacheFile
    this.options = options
    this.ttlHours = ttlHours
    this.log = log
  }

  /** 配置变更时更新端点/代理/TTL（不触发拉取；调度方决定时机）。 */
  reconfigure(options: CatalogFetchOptions, ttlHours: number): void {
    this.options = options
    this.ttlHours = ttlHours
  }

  /** 已加载文档（缓存或拉取成功后可用；失败沿用旧数据）。 */
  getDocument(): CatalogDocument | null {
    return this.document
  }

  status(): CatalogStatus {
    return { fetchedAt: this.fetchedAt, error: this.lastError, refreshing: this.refreshing }
  }

  /** 启动加载：读磁盘缓存，需要时后台刷新（永不抛错）。 */
  async ensureLoaded(): Promise<void> {
    await this.loadDiskCache()
    if (this.document === null || this.isStale()) await this.refresh()
  }

  /** 强制后台刷新（进行中复用同一次拉取）。 */
  async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const reply = await fetchJsonVia(
        this.options.url,
        this.options.proxy,
        this.options.timeoutMs,
        this.options.maxBytes,
      )
      if (reply.status < 200 || reply.status >= 300) throw new Error(`HTTP ${reply.status}`)
      const data = JSON.parse(reply.body) as unknown
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('响应不是 models.dev 目录文档')
      }
      this.document = data as CatalogDocument
      this.fetchedAt = new Date().toISOString()
      this.lastError = null
      await this.persist(data as CatalogDocument, this.fetchedAt)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.log(`models.dev 拉取失败（沿用缓存）：${this.lastError}`)
    } finally {
      this.refreshing = false
    }
  }

  private isStale(): boolean {
    if (this.fetchedAt === null) return true
    const ageMs = Date.now() - Date.parse(this.fetchedAt)
    return !Number.isFinite(ageMs) || ageMs > this.ttlHours * 3_600_000
  }

  private async loadDiskCache(): Promise<void> {
    if (!existsSync(this.cacheFile)) return
    try {
      const raw = JSON.parse(await readFile(this.cacheFile, 'utf8')) as CacheFile
      if (
        typeof raw?.fetchedAt !== 'string' ||
        typeof raw.data !== 'object' ||
        raw.data === null ||
        Array.isArray(raw.data)
      ) {
        return
      }
      this.document = raw.data
      this.fetchedAt = raw.fetchedAt
    } catch {
      // 缓存损坏：静默留给刷新补齐
    }
  }

  private async persist(data: CatalogDocument, fetchedAt: string): Promise<void> {
    try {
      const dir = dirname(this.cacheFile)
      if (!existsSync(dir)) await mkdir(dir, { recursive: true })
      const tmp = `${this.cacheFile}.tmp-${process.pid}`
      await writeFile(tmp, JSON.stringify({ fetchedAt, data }), 'utf8')
      await rename(tmp, this.cacheFile)
    } catch (error) {
      this.log(`models.dev 缓存写入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
