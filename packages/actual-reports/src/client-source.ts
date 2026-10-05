/**
 * 服务端托管的客户端资产访问：把「界面里才有的语义」（报表区间词汇、卡片渲染细节、
 * 实验开关门控）变成可本地检索的源码，省掉联网翻官方仓库那一步。
 *
 * 事实：Actual 服务端静态托管整个 Web 客户端，且随构建产出 source map——map 里带
 * 原始源码（`sourcesContent`）。资产名内嵌内容哈希，因此天然可长期缓存；本模块只
 * 读服务端，不读磁盘上的容器文件，部署形态无关。
 *
 * 一切失败都显式报错并说明覆盖率（读了几份资产、还剩几份没读），不做静默降级。
 * @module @dsh-plus/actual-reports/client-source
 */

import type { ReportsConfig } from './env.ts'
import { joinPath, type ReportsIo } from './node-io.ts'

/** 一份客户端源码。 */
export interface ClientSourceEntry {
  path: string
  /** 提供它的资产 URL（诊断用）。 */
  asset: string
  text: string
}

/** 客户端源码索引与本次读取的覆盖率。 */
export interface ClientSourceIndex {
  serverUrl: string
  /** 本次真正读进来的资产。 */
  searched: string[]
  /** 因 `--max-assets` 上限没读的资产。 */
  skipped: string[]
  entries: ClientSourceEntry[]
}

/** 检索命中。 */
export interface SourceMatch {
  path: string
  line: number
  text: string
}

/** 单次 HTTP 取回的超时（毫秒）。 */
const HTTP_TIMEOUT_MS = 20000

/** 资产发现结果。 */
interface Assets {
  entryUrl: string
  chunkUrls: string[]
}

/** 客户端资产缓存目录。 */
function cacheDir(config: ReportsConfig): string {
  const safe = config.serverUrl.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return joinPath(config.dataDir, 'client-source', safe === '' ? 'server' : safe)
}

/** 拼接服务端 URL（去重斜杠）。 */
function urlOf(serverUrl: string, path: string): string {
  const base = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl
  const tail = path.startsWith('/') ? path : `/${path}`
  return `${base}${tail}`
}

/** 取回文本：连不上、非 2xx 都显式报错。 */
async function fetchText(io: ReportsIo, url: string, what: string): Promise<string> {
  const response = await io.http.getText(url, HTTP_TIMEOUT_MS)
  if (response === undefined) {
    throw new Error(`连不上 Actual 服务端：${url}（${what}）。请确认服务端地址可用。`)
  }
  if (response.status !== 200) {
    throw new Error(
      `${what}取不到（HTTP ${response.status}）：${url}。` +
        '服务端可能没有托管 Web 客户端，或该版本的资产布局不同。',
    )
  }
  return response.text
}

/** 缓存文件路径（资产名内嵌内容哈希，可按名长期缓存）。 */
function cacheFile(config: ReportsConfig, url: string): string {
  return joinPath(cacheDir(config), url.split('/').pop() ?? 'asset')
}

/** 带缓存的取回（连不上/非 2xx 由 `fetchText` 报错）。 */
async function fetchCached(
  io: ReportsIo,
  config: ReportsConfig,
  url: string,
  what: string,
): Promise<string> {
  const file = cacheFile(config, url)
  const cached = await io.fs.readText(file)
  if (cached !== undefined) return cached
  const text = await fetchText(io, url, what)
  await io.fs.writeTextAtomic(file, text)
  return text
}

/** 取一份 source map 的文本；不可用返回 undefined（缓存命中则不再请求）。 */
async function mapTextOf(
  io: ReportsIo,
  config: ReportsConfig,
  url: string,
): Promise<string | undefined> {
  const file = cacheFile(config, url)
  const cached = await io.fs.readText(file)
  if (cached !== undefined) return cached
  const response = await io.http.getText(url, HTTP_TIMEOUT_MS)
  if (response === undefined || response.status !== 200) return undefined
  await io.fs.writeTextAtomic(file, response.text)
  return response.text
}

/** 从入口 HTML 里挑出入口脚本。 */
function entryOf(html: string, serverUrl: string): string {
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map(
    (item) => item[1] as string,
  )
  if (scripts.length === 0) {
    throw new Error(
      `服务端首页里没有脚本引用（${serverUrl}）：无法定位客户端资产。` +
        '可直接改用 `--kind core`（本机官方 CLI 自带的源码）。',
    )
  }
  const entry = scripts.find((item) => /\/index\.[^/]*\.js$/.test(item)) ?? (scripts[0] as string)
  return entry.startsWith('http') ? entry : urlOf(serverUrl, entry)
}

/** 从入口 bundle 里取出按需加载的 chunk 列表（Vite 的 `__vite__mapDeps` 表）。 */
function chunkUrlsOf(bundle: string, serverUrl: string): string[] {
  const rel = new Set<string>()
  for (const match of bundle.matchAll(/"((?:\.\/)?(?:static\/)?js\/[^"]+\.chunk\.js)"/g)) {
    rel.add(match[1] as string)
  }
  if (rel.size === 0) {
    throw new Error(
      '服务端客户端 bundle 里找不到 chunk 清单（构建方式可能变了）：读不到客户端源码。' +
        '可改用 `--kind core`，或在界面里建一个样板组件后用 `dashboard widgets` 照抄 meta。',
    )
  }
  return [...rel].map((item) => urlOf(serverUrl, item.replace(/^\.\//, '')))
}

/** 发现可用资产：入口 bundle + 它引用的全部 chunk。 */
export async function discoverAssets(config: ReportsConfig, io: ReportsIo): Promise<Assets> {
  const html = await fetchText(io, urlOf(config.serverUrl, '/'), '服务端首页')
  const entryUrl = entryOf(html, config.serverUrl)
  const bundle = await fetchCached(io, config, entryUrl, '客户端入口 bundle')
  return { entryUrl, chunkUrls: [entryUrl, ...chunkUrlsOf(bundle, config.serverUrl)] }
}

/** 解析一份 source map 里的源码（无 `sourcesContent` 视为不可用）。 */
function sourcesOf(mapText: string, assetUrl: string): ClientSourceEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(mapText)
  } catch {
    return []
  }
  const record = parsed as { sources?: unknown; sourcesContent?: unknown }
  const paths = Array.isArray(record.sources) ? record.sources : []
  const contents = Array.isArray(record.sourcesContent) ? record.sourcesContent : []
  const entries: ClientSourceEntry[] = []
  for (const [index, path] of paths.entries()) {
    const text = contents[index]
    if (typeof path !== 'string' || typeof text !== 'string') continue
    entries.push({ path: normalizePath(path), asset: assetUrl, text })
  }
  return entries
}

/** 归一化 source map 里的相对路径（`../../../src/a.ts` → `src/a.ts`）。 */
export function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

/**
 * 读取客户端源码索引（按需取 source map，直到 `maxAssets` 份）。
 *
 * @throws 服务端不可达、资产布局不符或一份源码都读不到时抛出。
 */
export async function loadClientSources(
  config: ReportsConfig,
  io: ReportsIo,
  maxAssets: number,
): Promise<ClientSourceIndex> {
  const assets = await discoverAssets(config, io)
  const entries: ClientSourceEntry[] = []
  const searched: string[] = []
  const unusable: string[] = []
  for (const url of assets.chunkUrls) {
    if (searched.length >= maxAssets) break
    searched.push(url)
    const mapUrl = `${url}.map`
    const mapText = await mapTextOf(io, config, mapUrl)
    if (mapText === undefined) {
      unusable.push(mapUrl)
      continue
    }
    entries.push(...sourcesOf(mapText, url))
  }
  if (entries.length === 0) {
    throw new Error(
      `服务端没有可用的客户端 source map（试过 ${searched.length} 份资产，全部失败：` +
        `${unusable.slice(0, 3).join('、')}${unusable.length > 3 ? ' 等' : ''}）。` +
        '生产构建可能剔除了 source map；改用 `--kind core` 读本机官方源码。',
    )
  }
  return {
    serverUrl: config.serverUrl,
    searched,
    skipped: assets.chunkUrls.slice(searched.length),
    entries,
  }
}

/** 列出源码路径（可选子串过滤）。 */
export function listSources(index: ClientSourceIndex, match: string | undefined): string[] {
  const paths = index.entries.map((entry) => entry.path)
  const filtered = match === undefined ? paths : paths.filter((path) => path.includes(match))
  return [...new Set(filtered)].sort()
}

/** 按路径取源码正文。 */
export function readSource(index: ClientSourceIndex, path: string): string {
  const wanted = normalizePath(path)
  const entry = index.entries.find((item) => item.path === wanted)
  if (entry === undefined) {
    const near = listSources(index, wanted.split('/').pop() ?? wanted).slice(0, 5)
    throw new Error(
      `客户端源码里没有 ${path}。本次已读 ${index.searched.length} 份资产` +
        `${index.skipped.length > 0 ? `（还有 ${index.skipped.length} 份没读，可加大 --max-assets）` : ''}。` +
        `${near.length > 0 ? `相近路径：${near.join('、')}。` : ''}` +
        '用 `reference source --list --kind client` 看全部可读路径。',
    )
  }
  return entry.text
}

/** 正则检索（大小写敏感，命中数受 `max` 限制）。 */
export function grepSources(
  index: ClientSourceIndex,
  pattern: string,
  options: { context: number; max: number },
): { matches: SourceMatch[]; truncated: boolean } {
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`--grep 不是合法正则：${detail}`)
  }
  const matches: SourceMatch[] = []
  let truncated = false
  for (const entry of index.entries) {
    const lines = entry.text.split('\n')
    for (const [index0, line] of lines.entries()) {
      if (!regex.test(line)) continue
      if (matches.length >= options.max) {
        truncated = true
        break
      }
      const from = Math.max(0, index0 - options.context)
      const to = Math.min(lines.length, index0 + options.context + 1)
      matches.push({
        path: entry.path,
        line: index0 + 1,
        text: lines.slice(from, to).join('\n'),
      })
    }
    if (truncated) break
  }
  return { matches, truncated }
}
