/**
 * 模型发现：配置面"拉取可用模型"动作的后端（对齐官方 discoverModels 语义）。
 *
 * 与官方的差异：本插件 route 不是内置目录 id，目录直答改为"provider 级
 * extends 的内置源目录直答"；其余（手写 route 仅 openai 系协议走
 * GET {baseURL}/models、4MB 上限、署名头）与官方一致。结果不落盘。
 * @module llm-pi/discovery
 */
import { builtinModelIds, hasBuiltinProvider } from './catalog/builtin.ts'
import { officialModelIds } from './catalog/official.ts'
import type { ProviderProfileConfig } from './config.ts'
import type { DshKit } from './resolve-dsh.ts'

const LISTABLE_PROTOCOLS = new Set(['openai-completions', 'openai-responses'])
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export interface DiscoveryRequest {
  provider?: string
  baseURL?: string
  api?: string
  apiKey?: string
  signal?: AbortSignal
}

export interface DiscoveryEntry {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export interface DiscoveryDeps {
  kit: DshKit
  /** 当前生效的原始配置 providers 表（发现面对的是草稿/配置，不是物化产物）。 */
  configProviders: () => Record<string, ProviderProfileConfig | undefined>
  storedApiKey: (provider: string | undefined) => Promise<string | undefined>
}

/** 读取有界响应体：声明超长或累计超长都拒绝（对齐官方 readBounded）。 */
async function readBounded(kit: DshKit, response: Response, url: string): Promise<string> {
  const oversized = () =>
    new kit.LlmError(`${url} 响应超过 ${MAX_RESPONSE_BYTES} 字节`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** 解析 OpenAI 兼容模型清单；坏行跳过而非整表失败（对齐官方 readListing）。 */
function readListing(kit: DshKit, body: unknown): DiscoveryEntry[] {
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) {
    throw new kit.LlmError('端点的模型清单缺少 "data" 数组；请手工录入模型', 'DISCOVERY_FAILED')
  }
  const models: DiscoveryEntry[] = []
  for (const raw of data) {
    const entry = raw as Record<string, unknown>
    if (typeof entry?.['id'] !== 'string' || entry['id'].length === 0) continue
    const out: DiscoveryEntry = { id: entry['id'] }
    const name = entry['name'] ?? entry['display_name']
    if (typeof name === 'string' && name.length > 0) out.name = name
    for (const [key, field] of [
      ['context_window', 'contextWindow'],
      ['context_length', 'contextWindow'],
      ['max_output_tokens', 'maxTokens'],
      ['max_tokens', 'maxTokens'],
    ] as const) {
      const value = entry[key]
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value > 0 &&
        out[field] === undefined
      ) {
        out[field] = value
      }
    }
    models.push(out)
  }
  return models
}

/** deepseek 路由直答：extends 'deepseek' 给官方目录全量；否则给 route 自配模型。 */
function deepseekCatalogAnswer(kit: DshKit, route: ProviderProfileConfig): DiscoveryEntry[] {
  if (kit.deepseek === undefined) {
    throw new kit.LlmError(
      '当前运行时套件不含 dsh-llm-deepseek，无法读取官方目录',
      'DISCOVERY_FAILED',
    )
  }
  if (route.extends === 'deepseek') {
    return officialModelIds(kit).map((id) => ({ id }))
  }
  const models = (route.models ?? []).map((entry) => ({
    id: entry.id,
    ...(entry.name === undefined ? {} : { name: entry.name }),
    ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
    ...(entry.maxTokens === undefined ? {} : { maxTokens: entry.maxTokens }),
  }))
  if (models.length === 0) {
    throw new kit.LlmError(
      '该 route 未配置 models 且未 extends deepseek；请手工录入模型',
      'DISCOVERY_FAILED',
    )
  }
  return models
}

/** 内置目录直答（route 配了 provider 级 extends 时）。 */
function catalogAnswer(kit: DshKit, source: string): DiscoveryEntry[] {
  return builtinModelIds(kit, source).map((id) => {
    const models = kit.getBuiltinModels(source)
    const model = models.find((m) => m.id === id)
    return {
      id,
      ...(model?.name === undefined ? {} : { name: model.name }),
      ...(model?.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model?.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    }
  })
}

/**
 * 回答"该 provider 可服务哪些模型"：deepseek 路由读官方目录/自有配置直答；
 * extends 内置源零网络直答；否则仅 openai 系协议走 GET {baseURL}/models；
 * 其余协议明确不支持。
 */
export async function discoverModels(
  request: DiscoveryRequest,
  deps: DiscoveryDeps,
): Promise<DiscoveryEntry[]> {
  const { kit } = deps
  const route: ProviderProfileConfig | undefined =
    request.provider === undefined ? undefined : deps.configProviders()[request.provider]
  if ((route?.adapter ?? 'pi') === 'deepseek') {
    return deepseekCatalogAnswer(kit, route)
  }
  if (route?.extends !== undefined && hasBuiltinProvider(kit, route.extends)) {
    return catalogAnswer(kit, route.extends)
  }
  const baseURL = request.baseURL ?? route?.baseURL
  if (baseURL === undefined || baseURL.length === 0) {
    throw new kit.LlmError(
      `route ${JSON.stringify(request.provider ?? '')} 未配 baseURL 且 extends 源无内置目录；无法探测模型清单`,
      'DISCOVERY_FAILED',
    )
  }
  const api = request.api ?? route?.api ?? 'openai-completions'
  if (!LISTABLE_PROTOCOLS.has(api)) {
    throw new kit.LlmError(
      `协议 "${api}" 无可读取的模型清单端点；请手工录入模型`,
      'DISCOVERY_UNSUPPORTED',
    )
  }
  const url = `${baseURL.replace(/\/+$/, '')}/models`
  const supplied = request.apiKey ?? (await deps.storedApiKey(request.provider))
  let authorization: string | undefined
  if (supplied !== undefined) {
    const checked = kit.normalizeApiKey(supplied)
    if (!checked.ok) {
      throw new kit.LlmError(
        checked.reason === 'empty'
          ? 'API key 为空；请在 Models 页配置或留空以匿名探测'
          : 'API key 含有 HTTP 头无法携带的字符',
        kit.INVALID_CREDENTIAL_CODE,
      )
    }
    authorization = `Bearer ${checked.value}`
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(authorization === undefined ? {} : { authorization }),
        ...kit.attributionHeaders(),
      },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    if (request.signal?.aborted)
      throw new kit.LlmError('模型发现被调用方中止', 'ABORTED', {
        cause: error,
      })
    throw new kit.LlmError(`无法连接 ${url}`, 'DISCOVERY_FAILED', {
      cause: error,
    })
  }
  if (!response.ok) {
    throw new kit.LlmError(
      `${url} 返回 ${response.status}${response.status === 401 || response.status === 403 ? '；请检查 API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  const text = await readBounded(kit, response, url)
  try {
    return readListing(kit, JSON.parse(text))
  } catch (error) {
    if (error instanceof kit.LlmError) throw error
    throw new kit.LlmError(`${url} 未返回 JSON`, 'DISCOVERY_FAILED', {
      cause: error,
    })
  }
}
