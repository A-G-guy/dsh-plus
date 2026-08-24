/**
 * models.dev 兜底目录源：继承解析的第二级数据源。
 *
 * 只用于内置目录尚未收录的新模型/新供应商。数据是公开快照
 *（默认 https://models.dev/api.json），**默认不自动拉取**（catalogRefreshHours=0）；
 * 拉取方式二选一：
 * - 配置 catalogRefreshHours > 0：启动/过期后后台自动刷新；
 * - 配置卡片「手动拉取」或 POST /catalog/refresh：立即拉取。
 * 拉取可经 catalogProxy 代理（HTTP 代理，如 http://127.0.0.1:7890）。
 * 成功落盘缓存（storages/dsh-plus-llm-pi/models-dev.json）；任何失败都退化为
 * "仅内置目录"，绝不阻塞 route 注册。
 *
 * 保守原则：models.dev 数据未经 pi 官方校正（无 compat/thinkingLevelMap），
 * 且模态声明不被采信——继承自本源的模型 input 一律走 text-only 兜底，
 * 视觉等模态须用户在条目上显式声明（防 over-claiming 导致会话重复失败请求）。
 * @module llm-pi/catalog/models-dev
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { dirname } from 'node:path'

import HttpsProxyAgentModule from 'https-proxy-agent'

import type { ModelBase } from './builtin.ts'

/** 仅 https 目标走代理（http 目标直连；代理通常只提供 CONNECT 隧道）。 */
const { HttpsProxyAgent } = HttpsProxyAgentModule as unknown as {
  HttpsProxyAgent: new (proxy: string) => unknown
}

export interface ModelsDevStatus {
  fetchedAt: string | null
  providers: number
  models: number
  error: string | null
}

interface ModelsDevModelEntry {
  id?: string
  name?: string
  reasoning?: boolean
  limit?: { context?: number; output?: number }
}

interface ModelsDevProviderEntry {
  id?: string
  name?: string
  models?: Record<string, ModelsDevModelEntry>
}

type ModelsDevDocument = Record<string, ModelsDevProviderEntry>

interface CacheFile {
  fetchedAt: string
  data: ModelsDevDocument
}

const FETCH_TIMEOUT_MS = 20000
/** 目录文档体上限（api.json 全量约 1-2MB，放宽到 20MB 防未来膨胀）。 */
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024

interface JsonResponse {
  status: number
  body: string
}

/**
 * 极简 JSON GET（node:http(s) 实现）：支持 HTTP 代理（仅 https 目标）与超时。
 * 不跟随重定向（models.dev 直链无重定向；自定义端点需自行保证可直达）。
 */
function fetchJson(url: string, proxy: string, timeoutMs: number): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const request = target.protocol === 'https:' ? httpsRequest : httpRequest
    const agent =
      target.protocol === 'https:' && proxy.length > 0 ? new HttpsProxyAgent(proxy) : undefined
    const req = request(
      url,
      { agent, timeout: timeoutMs, headers: { accept: 'application/json' } },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        let settled = false
        const fail = (error: Error): void => {
          if (settled) return
          settled = true
          reject(error)
        }
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('响应超过 20MB 上限'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (settled) return
          settled = true
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        // 响应流自身出错（中途截断的 aborted 等）不经请求转发：缺此监听时
        // Promise 永不 settle（req timeout 只覆盖建连/空闲等待），refresh 永久挂起。
        response.on('error', fail)
      },
    )
    req.on('timeout', () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)))
    req.on('error', reject)
    req.end()
  })
}

function isDocument(value: unknown): value is ModelsDevDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 单个 models.dev 模型条目 → 继承 base（仅采信名称/容量/推理能力）。 */
function toModelBase(entry: ModelsDevModelEntry): ModelBase {
  const base: ModelBase = {}
  if (typeof entry.name === 'string' && entry.name.length > 0) base.name = entry.name
  const context = entry.limit?.context
  if (typeof context === 'number' && Number.isInteger(context) && context > 0)
    base.contextWindow = context
  const output = entry.limit?.output
  if (typeof output === 'number' && Number.isInteger(output) && output > 0) base.maxTokens = output
  base.reasoning = entry.reasoning === true
  return base
}

export class ModelsDevSource {
  private readonly cacheFile: string
  private url: string
  private ttlHours: number
  private proxy: string
  private readonly log: (message: string) => void

  private document: ModelsDevDocument | undefined
  private fetchedAt: string | null = null
  private lastError: string | null = null
  private refreshing: Promise<void> | undefined

  constructor(
    cacheFile: string,
    url: string,
    ttlHours: number,
    log: (message: string) => void,
    proxy = '',
  ) {
    this.cacheFile = cacheFile
    this.url = url
    this.ttlHours = ttlHours
    this.log = log
    this.proxy = proxy
  }

  /** 配置变更时更新端点/TTL/代理并触发刷新（去抖由 refresh 的进行中复用承担）。 */
  reconfigure(url: string, ttlHours: number, proxy: string): void {
    if (url === this.url && ttlHours === this.ttlHours && proxy === this.proxy) return
    this.url = url
    this.ttlHours = ttlHours
    this.proxy = proxy
    if (ttlHours > 0 && this.isStale()) void this.refresh()
  }

  /** 是否已有可用数据（缓存或拉取成功）；与自动拉取开关无关。 */
  get enabled(): boolean {
    return this.document !== undefined
  }

  /** 加载缓存，并在启用自动拉取且缓存过期时后台刷新；构造后调用一次，永不抛错。 */
  async ensureLoaded(): Promise<void> {
    this.loadCache()
    if (this.ttlHours > 0 && this.isStale()) await this.refresh()
  }

  /** 强制刷新（手动拉取/配置变更触发）；ttlHours=0 时同样生效（手动拉取不受自动开关限制）。 */
  async refresh(): Promise<void> {
    this.refreshing ??= this.doFetch().finally(() => {
      this.refreshing = undefined
    })
    await this.refreshing
  }

  /** 查继承 base；未命中/未启用返回 undefined。 */
  lookup(provider: string, modelId: string): ModelBase | undefined {
    const entry = this.document?.[provider]?.models?.[modelId]
    if (entry === undefined) return undefined
    return toModelBase(entry)
  }

  /** 全部 provider id（UI extends 选择器用）。 */
  providerIds(): string[] {
    return Object.keys(this.document ?? {})
  }

  /** 某 provider 的模型 id 列表（UI extends 选择器用）。 */
  modelIds(provider: string): string[] {
    return Object.keys(this.document?.[provider]?.models ?? {})
  }

  status(): ModelsDevStatus {
    const providers = Object.keys(this.document ?? {})
    const models = providers.reduce(
      (total, p) => total + Object.keys(this.document?.[p]?.models ?? {}).length,
      0,
    )
    return {
      fetchedAt: this.fetchedAt,
      providers: providers.length,
      models,
      error: this.lastError,
    }
  }

  private isStale(): boolean {
    if (this.fetchedAt === null) return true
    const ageMs = Date.now() - Date.parse(this.fetchedAt)
    return !Number.isFinite(ageMs) || ageMs > this.ttlHours * 3600_000
  }

  private loadCache(): void {
    try {
      const raw = JSON.parse(readFileSync(this.cacheFile, 'utf8')) as CacheFile
      if (!isDocument(raw.data) || typeof raw.fetchedAt !== 'string')
        throw new Error('缓存形状非法')
      this.document = raw.data
      this.fetchedAt = raw.fetchedAt
    } catch {
      // 无缓存或缓存损坏：静默留给刷新补齐
    }
  }

  private async doFetch(): Promise<void> {
    try {
      const response = await fetchJson(this.url, this.proxy, FETCH_TIMEOUT_MS)
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data: unknown = JSON.parse(response.body)
      if (!isDocument(data)) throw new Error('响应不是 models.dev 目录文档')
      this.document = data
      this.fetchedAt = new Date().toISOString()
      this.lastError = null
      this.persistCache(data)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.log(`models.dev 目录拉取失败（沿用缓存/仅内置目录）：${this.lastError}`)
    }
  }

  private persistCache(data: ModelsDevDocument): void {
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true })
      const tmp = `${this.cacheFile}.tmp`
      writeFileSync(tmp, JSON.stringify({ fetchedAt: this.fetchedAt, data }), 'utf8')
      renameSync(tmp, this.cacheFile)
    } catch (error) {
      this.log(`models.dev 缓存写入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
