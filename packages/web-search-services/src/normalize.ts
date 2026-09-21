/**
 * search.py 输出 → dsh-web 标准 WebSearchResult 归一化（纯函数）。
 *
 * skill 各服务 request() 统一信封 {ok, service, status, data: <API 原始响应>}：
 * tavily/exa 业务字段在 data 下（results/answer），openai-chat 回答在
 * data.answer。按 selectedService 归一；字段缺失降级而非报错（对 skill
 * 脚本版本漂移保持容差）。
 * @module web-search-services/normalize
 */
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function makeSource(
  url: string,
  title?: string,
  snippet?: string,
  publishedAt?: string,
): WebSearchSource {
  return {
    url,
    ...(title !== undefined ? { title } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  }
}

/** skill 各服务 request() 统一信封 {ok, service, status, data: <API 响应>}；
 * 取 data 为业务 payload，data 缺失/空对象时回退顶层（旧形状容差）。 */
function payloadOf(raw: JsonObject): JsonObject {
  const data = asObject(raw.data)
  return Object.keys(data).length > 0 ? data : raw
}

function finish(content: string | undefined, sources: WebSearchSource[]): WebSearchResult {
  const seen = new Set<string>()
  const deduped = sources.filter((source) => {
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
  return {
    ...(content !== undefined ? { content } : {}),
    sources: deduped,
    truncated: false,
  }
}

function sourcesFromResults(
  results: unknown,
  pick: (item: JsonObject) => WebSearchSource | undefined,
): WebSearchSource[] {
  const out: WebSearchSource[] = []
  for (const entry of asArray(results)) {
    const source = pick(asObject(entry))
    if (source !== undefined) out.push(source)
  }
  return out
}

function normalizeTavily(raw: JsonObject): WebSearchResult {
  const payload = payloadOf(raw)
  const sources = sourcesFromResults(payload.results, (item) => {
    const url = asNonEmptyString(item.url)
    if (url === undefined) return undefined
    return makeSource(
      url,
      asNonEmptyString(item.title),
      asNonEmptyString(item.content),
      asNonEmptyString(item.published_date),
    )
  })
  return finish(asNonEmptyString(payload.answer), sources)
}

function normalizeExa(raw: JsonObject): WebSearchResult {
  const payload = payloadOf(raw)
  const sources = sourcesFromResults(payload.results, (item) => {
    const url = asNonEmptyString(item.url) ?? asNonEmptyString(item.id)
    if (url === undefined) return undefined
    const highlights = asArray(item.highlights)
      .map((h) => asNonEmptyString(h))
      .filter((h): h is string => h !== undefined)
    return makeSource(
      url,
      asNonEmptyString(item.title),
      highlights.length > 0 ? highlights.join(' ') : undefined,
      asNonEmptyString(item.publishedDate),
    )
  })
  return finish(undefined, sources)
}

const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g

/** 从生成式回答的 markdown 链接提取可引用来源（DeepSeek 官方 provider 同样只给
 *  URL/标题）。无链接时返回空表——content-only 结果在 WebSearchResult 合法。 */
export function extractMarkdownLinks(markdown: string, limit: number): WebSearchSource[] {
  const seen = new Set<string>()
  const out: WebSearchSource[] = []
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    const url = match[2]
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    const label = match[1] ?? ''
    out.push(makeSource(url, label.trim() !== '' ? label : undefined))
    if (out.length >= limit) break
  }
  return out
}

function normalizeOpenAiChat(raw: JsonObject): WebSearchResult {
  const answer = asNonEmptyString(asObject(raw.data).answer)
  if (answer === undefined) {
    throw new Error('openai-chat 结果缺少 data.answer')
  }
  return finish(answer, extractMarkdownLinks(answer, 16))
}

function formatAttempts(attempts: unknown): string {
  const summary = asArray(attempts)
    .map((entry) => {
      const item = asObject(entry)
      const service = asNonEmptyString(item.service) ?? '?'
      const message = asNonEmptyString(item.error) ?? 'unknown'
      return `${service}: ${message}`
    })
    .join('; ')
  return summary === '' ? '' : `（尝试过: ${summary}）`
}

/** 归一化 search.py 的完整 stdout JSON；失败以 Error 抛出（provider 层包 WebError）。 */
export function normalizeSearchOutput(raw: unknown): WebSearchResult {
  const obj = asObject(raw)
  if (obj.ok === false) {
    const detail = asNonEmptyString(obj.error) ?? 'search.py 返回 ok=false'
    throw new Error(`${detail}${formatAttempts(obj.attempts)}`)
  }
  const service = asNonEmptyString(obj.selectedService) ?? asNonEmptyString(obj.service)
  switch (service) {
    case 'tavily':
      return normalizeTavily(obj)
    case 'exa':
      return normalizeExa(obj)
    case 'openai-chat':
      return normalizeOpenAiChat(obj)
    default:
      throw new Error(`search.py 返回未知或不支持的 selectedService: ${JSON.stringify(service)}`)
  }
}
