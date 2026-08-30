/**
 * profile 构建器（0.1.2-alpha.1 适配版）：插件 Config → 官方 schema 形状的
 * 「前置数据源归一化」→ 官方 resolveProfiles（或插件等价兜底）→
 * ResolvedPiAiProviderProfile。
 *
 * 适配决策（resolveProfiles 复用评估，2026-08）：
 * - 官方 resolveProfiles 仅在 @deepseek-ai/dsh-llm-pi-ai 的 src/config.ts 子路径
 *   导出，npm 发布形态不携带 src/（lib/index.js 单 bundle），包根也不导出该
 *   符号——真实部署（npm 布局 dsh 树）与 vendored 兜底都无法引用官方解析链；
 * - 因此：dsh 树 dev 布局（src 存在）时经 src 子路径复用官方 resolveProfiles
 *   （resolve-dsh.ts 探测），其余形态走本文件的 resolveProfilesFallback——
 *   语义逐行对齐官方 config.ts:resolveProfiles + catalog.ts:resolveRouteModels
 *   （协议限定本插件三协议），compat 门控以官方 catalog.ts COMPAT_GATES 为
 *   唯一事实源（见 compat.ts）；
 * - 两条路径的输入相同：插件独占的 extends/models.dev/草稿路由等语义在此
 *   「前置归一化」为全显式官方 schema 形状（模型条目字段全部落定），官方链
 *   不再需要目录查找；normalizeRoute 的产物经 kit.resolveProfiles 进入
 *   官方 adapter 消息链路。
 *
 * 与官方链的既有缝隙（记录在案）：
 * - 模型级 maxTokens 在官方 schema 中兼作「能力值」与「显式配置的请求默认
 *   cap」；归一化把继承值物化进条目后官方链会全部计入 configuredMaxTokens，
 *   此处按插件原语义回填为「仅用户显式配置」——请求默认 cap 行为不变；
 * - 官方 schema 无模型级 baseUrl/headers/cost：端点收敛为 route 级单一值
 *   （模型间端点不一致写时拒绝），headers/cost 不继承（0.84.2 目录无模型级
 *   headers；harness 不消费 cost 元数据，与官方 NO_COST 同口径）。
 * @module llm-pi/profiles
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  PiAiModelProfile,
  PiAiProviderProfile,
  ResolvedPiAiProviderProfile,
} from '@deepseek-ai/dsh-llm-pi-ai'

import {
  builtinProviderBaseUrl,
  inheritedCatalogEntries,
  type ModelBase,
} from './catalog/builtin.ts'
import type { ModelsDevSource } from './catalog/models-dev.ts'
import { mergeCompat, validateCompat } from './compat.ts'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  MAX_TIMER_DELAY_MS,
  type ModelEntryConfig,
  type ProviderProfileConfig,
  THINKING_LEVELS,
} from './config.ts'
import { ExtendsError, resolveModelBase } from './inherit.ts'
import { buildDeepseekRoutes } from './profiles-deepseek.ts'
import type { DshKit } from './resolve-dsh.ts'

/** 内置目录未描述时的零价目（harness 不消费 cost 元数据，同官方 NO_COST）。 */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export interface BuildDeps {
  kit: DshKit
  modelsDev?: ModelsDevSource
  /**
   * 运行期宽松模式：数据源漂移（models.dev 刷新/内置目录变化）导致已写入的
   * extends 引用失效时，降级/跳过并告警，而不是抛错把整个 route 弄挂。
   * 写时校验（assertServiceable）保持严格（缺省），非法引用在写入处拒绝。
   */
  lenient?: boolean
  /** lenient 模式下的告警通道（service 层接 logger）。 */
  warn?: (message: string) => void
}

/** 报告不可服务的 route，命名出错配置键（对齐官方 invalid()）。 */
function invalid(provider: string, detail: string): never {
  throw new Error(`llm-pi: provider "${provider}" ${detail}`)
}

/** 条目的声明模态；缺省/空数组都视为"无答案"，交下一级（同官方 declaredInput）。 */
function declaredInput(
  configured: readonly ('text' | 'image')[] | undefined,
): ('text' | 'image')[] | undefined {
  return configured === undefined || configured.length === 0 ? undefined : [...configured]
}

/** 显式 reasoningEfforts 字典的合法性校验（官方 resolveModelReasoning 同款规则）。 */
function validateReasoningEfforts(
  provider: string,
  entryId: string,
  efforts: Record<string, string | null>,
): void {
  if (Object.keys(efforts).length === 0) {
    invalid(provider, `model "${entryId}" 的 reasoningEfforts 为空：声明档位、置 false 或缺省继承`)
  }
  for (const level of THINKING_LEVELS) {
    const wire = efforts[level]
    if (wire === undefined) continue
    if (wire === null) {
      if (level !== 'off')
        invalid(provider, `model "${entryId}" reasoningEfforts.${level} 需要线值；仅 off 可留空`)
    } else if (wire.length === 0) {
      invalid(provider, `model "${entryId}" reasoningEfforts.${level} 不能为空字符串`)
    }
  }
  const declared = THINKING_LEVELS.filter((level) => efforts[level] !== undefined)
  if (!declared.some((level) => level !== 'off')) {
    invalid(provider, `model "${entryId}" reasoningEfforts 只有 off；声明思考档位或置 false`)
  }
}

/**
 * 继承源的 reasoning 能力 → 官方 reasoningEfforts 字典（全显式归一化的一环）。
 * - base 无推理能力 → false（与官方"手写模型缺省不推理"同语义）；
 * - base 带 thinkingLevelMap → 逐档位翻译：线值照抄；null（不支持）不声明
 *   （dict 未声明档位置 null = 不支持，语义一致）；缺省档位（off/minimal/
 *   low/medium/high）线值 = 档位名（pi-ai dispatch 的 `map?.[level] ?? level`），
 *   xhigh/max 缺省 = 不支持（pi-ai 对两档的缺省语义）——翻译后支持档位集合
 *   与线值与内置目录逐档位一致；
 * - base 只有 reasoning:true 无表（models.dev 保守源）→ 声明基档位为默认
 *   线值、xhigh/max 不支持——与 pi-ai 无表默认语义一致。
 */
function reasoningEffortsFromBase(
  provider: string,
  entry: ModelEntryConfig,
  base: ModelBase,
): false | Record<string, string | null> {
  if (entry.reasoningEfforts !== undefined) {
    if (entry.reasoningEfforts === false) return false
    validateReasoningEfforts(provider, entry.id, entry.reasoningEfforts)
    return entry.reasoningEfforts
  }
  if (base.reasoning !== true) return false
  const map = base.thinkingLevelMap
  if (map === undefined) {
    return { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' }
  }
  const dict: Record<string, string | null> = {}
  for (const level of THINKING_LEVELS) {
    const wire = map[level]
    if (wire === undefined) {
      if (level === 'xhigh' || level === 'max') continue // 未声明 = 不支持
      dict[level] = level
    } else if (wire !== null) {
      dict[level] = wire
    }
  }
  return dict
}

/** 归一化物化的单模型条目（含解析期事实，供 route 级唯一性检查）。 */
interface MaterializedEntry {
  entry: PiAiModelProfile
  api: string
  baseUrl: string | undefined
}

/**
 * 物化单个模型为官方 schema 条目（全显式）。lenient 下缺 api/baseURL 时
 * 返回 null（调用方跳过该模型）。
 */
function materializeModel(
  route: string,
  profile: ProviderProfileConfig,
  entry: ModelEntryConfig,
  base: ModelBase,
  routeApi: string | undefined,
  defaultInput: ('text' | 'image')[],
  deps: BuildDeps,
): MaterializedEntry | null {
  const legacyImageDetail = (entry as ModelEntryConfig & { imageDetail?: unknown }).imageDetail
  if (legacyImageDetail !== undefined) {
    invalid(
      route,
      `model "${entry.id}" 的 imageDetail 已随 0.1.2-alpha.1 移除；` +
        '请改用 imagePixelBudget/imageMaxBytes（仅 adapter: deepseek）并删除 imageDetail',
    )
  }
  const api = profile.api ?? base.api ?? routeApi
  if (api === undefined) {
    if (deps.lenient) {
      deps.warn?.(
        `llm-pi: provider "${route}" model "${entry.id}" 无法获得 api（继承源缺失），已跳过该模型`,
      )
      return null
    }
    invalid(route, `model "${entry.id}" 需要 api：继承源未提供，请在 route 上设置 api`)
  }
  const baseUrl =
    profile.baseURL ?? base.baseUrl ?? builtinProviderBaseUrl(deps.kit, profile.extends ?? '')
  if (baseUrl === undefined) {
    if (deps.lenient) {
      deps.warn?.(
        `llm-pi: provider "${route}" model "${entry.id}" 无法获得 baseURL（继承源缺失），已跳过该模型`,
      )
      return null
    }
    invalid(route, `model "${entry.id}" 需要 baseURL：继承源未提供，请在 route 上设置 baseURL`)
  }
  const name = entry.name ?? base.name ?? entry.id
  const contextWindow =
    entry.contextWindow ??
    base.contextWindow ??
    profile.defaultContextWindow ??
    DEFAULT_CONTEXT_WINDOW
  const maxTokens =
    entry.maxTokens ?? base.maxTokens ?? profile.defaultMaxTokens ?? DEFAULT_MAX_TOKENS
  const input = declaredInput(entry.input) ?? base.input ?? [...defaultInput]
  // compat 校验（官方门控表 + schema 值约束）→ 合并（继承值仅同协议继承）
  validateCompat(api, profile.compat as Record<string, unknown> | undefined, `provider "${route}"`)
  validateCompat(
    api,
    entry.compat as Record<string, unknown> | undefined,
    `provider "${route}" model "${entry.id}"`,
  )
  const compat = mergeCompat(
    base.api === api ? (base.compat as Record<string, unknown> | undefined) : undefined,
    profile.compat as Record<string, unknown> | undefined,
    entry.compat as Record<string, unknown> | undefined,
  )
  // 注意：不再对合并结果复验——base.compat 来自官方内置目录（extends），
  // 目录自身有权携带 withhold 键（如 supportsOpenAIGrammarTools）；门控只约束
  // 用户手写层（上面两次 validateCompat）。
  return {
    entry: {
      id: entry.id,
      ...(name === entry.id ? {} : { name }),
      ...(contextWindow === DEFAULT_CONTEXT_WINDOW ? {} : { contextWindow }),
      ...(maxTokens === DEFAULT_MAX_TOKENS ? {} : { maxTokens }),
      ...(input.length === 1 && input[0] === 'text' ? {} : { input }),
      reasoningEfforts: reasoningEffortsFromBase(route, entry, base),
      ...(compat === undefined ? {} : { compat }),
    },
    api,
    baseUrl,
  }
}

/**
 * 物化一个 route 的全部模型为官方条目；返回 route 级唯一 api/baseURL 与
 * 用户显式配置的请求 cap 表。lenient 下 route 无任何可服务模型时返回 null。
 */
function materializeRouteModels(
  route: string,
  profile: ProviderProfileConfig,
  deps: BuildDeps,
  defaultInput: ('text' | 'image')[],
): {
  models: PiAiModelProfile[]
  api: string
  baseUrl: string
  configuredMaxTokens: Map<string, number>
} | null {
  const configuredMaxTokens = new Map<string, number>()
  const entries: { id: string; entry?: ModelEntryConfig; base: ModelBase }[] = []
  if (profile.models !== undefined && profile.models.length > 0) {
    const seen = new Set<string>()
    for (const entry of profile.models) {
      if (entry.id.length === 0) invalid(route, '存在空 id 的模型条目')
      if (seen.has(entry.id)) invalid(route, `模型 "${entry.id}" 重复列出`)
      seen.add(entry.id)
      let base: ModelBase
      try {
        base = resolveModelBase(route, profile, entry, deps.kit, deps.modelsDev).base
      } catch (error) {
        // 运行期数据源漂移：已写入的引用在当前目录 miss。严格模式（写时校验）保持拒绝；
        // lenient 模式降级为手写条目并告警，避免整个 route 不可服务。
        if (!deps.lenient || !(error instanceof ExtendsError)) throw error
        deps.warn?.(
          `llm-pi: provider "${route}" model "${entry.id}" 的 extends 引用当前不可解析` +
            `（${error.message}）；已降级为手写条目`,
        )
        base = {}
      }
      // 仅用户显式配置的 maxTokens 是"部署选择"（请求默认 cap）；继承值只作能力。
      if (entry.maxTokens !== undefined) configuredMaxTokens.set(entry.id, entry.maxTokens)
      entries.push({ id: entry.id, entry, base })
    }
  } else if (profile.extends !== undefined) {
    for (const { id, base } of inheritedCatalogEntries(deps.kit, profile.extends)) {
      entries.push({ id, base })
    }
    if (entries.length === 0) {
      invalid(route, `extends 源 "${profile.extends}" 在内置目录中没有模型；请显式列出 models`)
    }
  } else {
    invalid(route, '未配置 models 且未配置 provider 级 extends；本 route 无模型可服务')
  }
  const apis = new Set(
    entries
      .map(({ base }) => profile.api ?? base.api)
      .filter((api): api is string => api !== undefined),
  )
  const routeApi = apis.size === 1 ? [...apis][0] : undefined
  const materialized = entries
    .map(({ id, entry, base }) =>
      materializeModel(route, profile, entry ?? { id }, base, routeApi, defaultInput, deps),
    )
    .filter((model): model is MaterializedEntry => model !== null)
  if (materialized.length === 0) {
    if (deps.lenient) {
      deps.warn?.(
        `llm-pi: provider "${route}" 当前没有可服务的模型（继承源漂移），已跳过该 route 的注册`,
      )
      return null
    }
    invalid(route, 'route 内没有可服务的模型')
  }
  const apisFinal = new Set(materialized.map((m) => m.api))
  if (apisFinal.size > 1) {
    invalid(
      route,
      `route 内模型协议不一致（${[...apisFinal].join(', ')}）；一个 route 只能服务一种协议`,
    )
  }
  const baseUrls = new Set(materialized.map((m) => m.baseUrl))
  if (baseUrls.size > 1) {
    invalid(
      route,
      `route 内模型端点不一致（${[...baseUrls].join(', ')}）；` +
        '官方 schema 无模型级端点，请以 route 级 baseURL 统一',
    )
  }
  return {
    models: materialized.map((m) => m.entry),
    api: materialized[0]?.api as string,
    baseUrl: materialized[0]?.baseUrl as string,
    configuredMaxTokens,
  }
}

/**
 * 草稿路由：adapter pi、无 models 且无 provider 级 extends——占位待补
 * （用户先建路由、后填模型的工作流）。草稿不注册进 adapter（无模型可服务），
 * 但仍出现在可配置 provider 目录里（Models 页/配置卡片可见可编辑）。
 */
export function isDraftRoute(profile: ProviderProfileConfig): boolean {
  return (
    (profile.adapter ?? 'pi') === 'pi' &&
    (profile.models === undefined || profile.models.length === 0) &&
    profile.extends === undefined
  )
}

interface NormalizedRoute {
  profile: PiAiProviderProfile
  /** 用户显式配置的每请求输出 cap（仅 raw entry.maxTokens 显式设置的条目）。 */
  configuredMaxTokens: Map<string, number>
}

/**
 * 前置数据源归一化：一个 route → 官方 schema 形状的全显式 profile。
 * 不可服务的 route（deepseek 路由 / 草稿 / lenient 下无模型）返回 undefined。
 * 校验规则对齐官方 resolveProfiles（baseURL/displayName 非空、idle 超时边界、
 * 图片限额正整数、defaultInput 非空）。
 */
function normalizeRoute(
  route: string,
  profile: ProviderProfileConfig,
  deps: BuildDeps,
): NormalizedRoute | undefined {
  // adapter: deepseek 的 route 由 profiles-deepseek.ts 物化（官方 DeepSeekAdapter 链路）
  if ((profile.adapter ?? 'pi') === 'deepseek') return undefined
  if (isDraftRoute(profile)) return undefined // 草稿路由：占位待补，不进 adapter
  if (route.length === 0) throw new Error('llm-pi: provider 名不能为空')
  // 注意：不做"route 名与内置 provider 名重名"的静态校验——内置名 ≠ 已注册
  // route（如官方 llm-pi-ai 配置清空后 anthropic 名可用）。真实冲突只在注册期
  // 暴露（DUPLICATE_ADAPTER），由 service 层逐个 route 注册降级处理。
  if (profile.baseURL !== undefined && profile.baseURL.length === 0) invalid(route, 'baseURL 为空')
  if (profile.displayName !== undefined && profile.displayName.length === 0)
    invalid(route, 'displayName 为空')
  const streamIdleTimeoutMs = profile.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (
    !Number.isFinite(streamIdleTimeoutMs) ||
    streamIdleTimeoutMs <= 0 ||
    streamIdleTimeoutMs > MAX_TIMER_DELAY_MS
  ) {
    invalid(route, `streamIdleTimeoutMs 必须是 (0, ${MAX_TIMER_DELAY_MS}] 内的有限数`)
  }
  const maxRequestImageBytes = profile.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES
  if (!Number.isInteger(maxRequestImageBytes) || maxRequestImageBytes <= 0) {
    invalid(route, 'maxRequestImageBytes 必须是正整数')
  }
  const requestImagePixelBudget =
    profile.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET
  if (!Number.isSafeInteger(requestImagePixelBudget) || requestImagePixelBudget <= 0) {
    invalid(route, 'requestImagePixelBudget 必须是正整数')
  }
  const requestImageMaxBytes = profile.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES
  if (!Number.isSafeInteger(requestImageMaxBytes) || requestImageMaxBytes <= 0) {
    invalid(route, 'requestImageMaxBytes 必须是正整数')
  }
  const defaultInput = [...(profile.defaultInput ?? ['text'])] as ('text' | 'image')[]
  if (defaultInput.length === 0) invalid(route, 'defaultInput 至少要声明一种模态')
  const materialized = materializeRouteModels(route, profile, deps, defaultInput)
  if (materialized === null) return undefined // lenient 下 route 无模型可服务，跳过注册
  const { api, baseUrl, models, configuredMaxTokens } = materialized
  const factory = deps.kit.protocolFactories[api as keyof DshKit['protocolFactories']]
  if (factory === undefined) {
    invalid(
      route,
      `api ${JSON.stringify(api)} 本插件无法服务（支持：openai-completions/openai-responses/anthropic-messages）`,
    )
  }
  const displayName = profile.displayName ?? route
  return {
    profile: {
      ...(profile.apiKeyEnv === undefined ? {} : { apiKeyEnv: profile.apiKeyEnv }),
      displayName,
      api,
      ...(baseUrl === undefined ? {} : { baseURL: baseUrl }),
      models,
      ...(profile.defaultContextWindow === undefined
        ? {}
        : { defaultContextWindow: profile.defaultContextWindow }),
      ...(profile.defaultMaxTokens === undefined
        ? {}
        : { defaultMaxTokens: profile.defaultMaxTokens }),
      defaultInput,
      ...(profile.headers === undefined ? {} : { headers: profile.headers }),
      ...(profile.reasoning === undefined ? {} : { reasoning: profile.reasoning }),
      ...(profile.thinkingBudgets === undefined
        ? {}
        : { thinkingBudgets: profile.thinkingBudgets }),
      ...(profile.cacheRetention === undefined ? {} : { cacheRetention: profile.cacheRetention }),
      ...(profile.transport === undefined ? {} : { transport: profile.transport }),
      ...(profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs }),
      ...(profile.websocketConnectTimeoutMs === undefined
        ? {}
        : { websocketConnectTimeoutMs: profile.websocketConnectTimeoutMs }),
      ...(profile.streamIdleTimeoutMs === undefined
        ? {}
        : { streamIdleTimeoutMs: profile.streamIdleTimeoutMs }),
      ...(profile.maxRequestImageBytes === undefined
        ? {}
        : { maxRequestImageBytes: profile.maxRequestImageBytes }),
      ...(profile.requestImagePixelBudget === undefined
        ? {}
        : { requestImagePixelBudget: profile.requestImagePixelBudget }),
      ...(profile.requestImageMaxBytes === undefined
        ? {}
        : { requestImageMaxBytes: profile.requestImageMaxBytes }),
      ...(profile.retryPolicy === undefined ? {} : { retryPolicy: profile.retryPolicy }),
    } as PiAiProviderProfile,
    configuredMaxTokens,
  }
}

/** Harness 自管凭据的 api-key auth（对齐官方 harnessApiKeyAuth）。 */
function harnessApiKeyAuth(name: string) {
  return {
    name,
    resolve: ({ credential }: { credential?: { key?: string } }) =>
      Promise.resolve({
        auth: credential?.key === undefined ? {} : { apiKey: credential.key },
        source: name,
      }),
  }
}

/** resolveProfilesFallback 的套件依赖窄面（与 kit 同源，见 resolve-dsh.ts）。 */
export interface ResolverDeps {
  createProvider: DshKit['createProvider']
  protocolFactories: DshKit['protocolFactories']
  resolveRetryPolicy: DshKit['resolveRetryPolicy']
}

/** 官方 resolveModelReasoning 的插件侧镜像：dict → {reasoning, thinkingLevelMap}。 */
function resolveModelReasoning(entry: PiAiModelProfile): {
  reasoning: boolean
  thinkingLevelMap?: Record<string, string | null>
} {
  const efforts = entry.reasoningEfforts
  if (efforts === undefined || efforts === false) return { reasoning: false }
  const map: Record<string, string | null> = {}
  for (const level of THINKING_LEVELS) {
    const wire = (efforts as Record<string, string | null | undefined>)[level]
    if (wire === undefined) map[level] = null
    else if (wire !== null) map[level] = wire
  }
  return { reasoning: true, thinkingLevelMap: map }
}

/**
 * 官方 resolveModelCompat 的插件侧镜像（fallback 专用）：透传物化条目的 compat。
 * 与官方的差异是有意的：官方校验的是用户原始条目（写时拒绝非 offer 字段），
 * 而本 fallback 收到的条目已经归一化物化（继承值落定、用户层在 materializeModel
 * 经 validateCompat 门控校验过）——compat 里可能合法携带内置目录的 withhold 键
 * （如 supportsOpenAIGrammarTools），再做门控只会误杀目录继承值。
 */
function resolveModelCompat(
  provider: string,
  entry: PiAiModelProfile,
  _api: string,
): { compat: Record<string, unknown> } | Record<string, never> {
  const configured: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(entry.compat ?? {})) {
    if (value === undefined || value === null) {
      invalid(provider, `model "${entry.id}" 的 compat.${field} 未设置值；给出值或移除该键`)
    }
    configured[field] = value
  }
  if (Object.keys(configured).length === 0) return {}
  return { compat: configured }
}

/**
 * 官方 resolveProfiles 的插件等价实现（npm 形态无 src/config.ts 可导入时兜底）。
 * 输入为 normalizeRoute 的全显式产物（api/baseURL/条目字段全部落定），语义与
 * 官方 config.ts:resolveProfiles + catalog.ts:resolveRouteModels 逐行对齐：
 * 默认值（streamIdleTimeoutMs/图片限额/容量兜底）、retryPolicy 解析、
 * configuredMaxTokens（此处按全显式条目计入，buildProfiles 再回填为用户显式
 * 集）、createProvider 构建 piProvider（harness api-key auth）。
 */
export function resolveProfilesFallback(
  providers: Readonly<Record<string, PiAiProviderProfile>> | undefined,
  deps: ResolverDeps,
): Map<string, ResolvedPiAiProviderProfile> {
  const resolved = new Map<string, ResolvedPiAiProviderProfile>()
  for (const [provider, source] of Object.entries(providers ?? {})) {
    if (source.baseURL !== undefined && source.baseURL.length === 0) {
      invalid(provider, 'baseURL 为空')
    }
    if (source.displayName !== undefined && source.displayName.length === 0) {
      invalid(provider, 'displayName 为空')
    }
    const streamIdleTimeoutMs = source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
    if (
      !Number.isFinite(streamIdleTimeoutMs) ||
      streamIdleTimeoutMs <= 0 ||
      streamIdleTimeoutMs > MAX_TIMER_DELAY_MS
    ) {
      invalid(provider, `streamIdleTimeoutMs 必须是 (0, ${MAX_TIMER_DELAY_MS}] 内的有限数`)
    }
    const maxRequestImageBytes = source.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES
    if (!Number.isInteger(maxRequestImageBytes) || maxRequestImageBytes <= 0) {
      invalid(provider, 'maxRequestImageBytes 必须是正整数')
    }
    const requestImagePixelBudget =
      source.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET
    if (!Number.isSafeInteger(requestImagePixelBudget) || requestImagePixelBudget <= 0) {
      invalid(provider, 'requestImagePixelBudget 必须是正整数')
    }
    const requestImageMaxBytes = source.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES
    if (!Number.isSafeInteger(requestImageMaxBytes) || requestImageMaxBytes <= 0) {
      invalid(provider, 'requestImageMaxBytes 必须是正整数')
    }
    const defaultInput = [...(source.defaultInput ?? ['text'])]
    if (defaultInput.length === 0) invalid(provider, 'defaultInput 至少要声明一种模态')
    const displayName = source.displayName ?? provider
    const api = source.api
    if (api === undefined) {
      invalid(
        provider,
        '需要 api：本插件仅支持 openai-completions/openai-responses/anthropic-messages',
      )
    }
    const factory = deps.protocolFactories[api as keyof DshKit['protocolFactories']]
    if (factory === undefined) {
      invalid(
        provider,
        `api ${JSON.stringify(api)} 本插件无法服务（支持：openai-completions/openai-responses/anthropic-messages）`,
      )
    }
    if (source.baseURL === undefined) {
      invalid(provider, '需要 baseURL：官方 schema 无模型级端点，端点只能 route 级表达')
    }
    // 模型物化：全显式条目 + route 级 api/baseURL（官方 resolveRouteModels 镜像，
    // 无目录继承——归一化已把继承值落定在条目里）
    const configuredMaxTokens = new Map<string, number>()
    const seen = new Set<string>()
    const models = (source.models ?? []).map((entry) => {
      if (entry.id.length === 0) invalid(provider, '存在空 id 的模型条目')
      if (seen.has(entry.id)) invalid(provider, `模型 "${entry.id}" 重复列出`)
      seen.add(entry.id)
      const contextWindow =
        entry.contextWindow ?? source.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
      if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
        invalid(provider, `model "${entry.id}" contextWindow 必须是正整数`)
      }
      const maxTokens = entry.maxTokens ?? source.defaultMaxTokens ?? DEFAULT_MAX_TOKENS
      if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
        invalid(provider, `model "${entry.id}" maxTokens 必须是正整数`)
      }
      if (entry.maxTokens !== undefined) configuredMaxTokens.set(entry.id, entry.maxTokens)
      return {
        id: entry.id,
        name: entry.name ?? entry.id,
        api,
        provider,
        baseUrl: source.baseURL as string,
        input: [...(entry.input ?? defaultInput)],
        cost: NO_COST,
        contextWindow,
        maxTokens,
        ...resolveModelReasoning(entry),
        ...resolveModelCompat(provider, entry, api),
      }
    })
    if (models.length === 0) invalid(provider, 'route 内没有可服务的模型')
    const { apiKeyEnv, retryPolicy, models: _models, displayName: _displayName, ...rest } = source
    resolved.set(provider, {
      ...rest,
      provider,
      displayName,
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv: credentialRef(apiKeyEnv) }),
      streamIdleTimeoutMs,
      maxRequestImageBytes,
      requestImagePixelBudget,
      requestImageMaxBytes,
      retryPolicy: deps.resolveRetryPolicy(
        retryPolicy,
        `llm-pi: provider "${provider}" retryPolicy`,
      ),
      ...(rest.headers === undefined ? {} : { headers: { ...rest.headers } }),
      ...(rest.thinkingBudgets === undefined
        ? {}
        : { thinkingBudgets: { ...rest.thinkingBudgets } }),
      configuredMaxTokens,
      piProvider: deps.createProvider({
        id: provider,
        name: displayName,
        ...(source.baseURL === undefined ? {} : { baseUrl: source.baseURL }),
        auth: { apiKey: harnessApiKeyAuth(displayName) },
        models,
        api: factory() as never,
      }),
    } as ResolvedPiAiProviderProfile)
  }
  return resolved
}

/**
 * 校验并物化全部 pi route。任一 route 不可服务即整体抛错——
 * settings 写入校验与运行期 profiles 回调共用本函数，
 * 保证"写入时被拒"与"运行期不可能拿到坏配置"互为表里。
 * 草稿路由（isDraftRoute）跳过物化，不参与 adapter 注册。
 */
export function buildProfiles(
  providers: Record<string, ProviderProfileConfig> | undefined,
  deps: BuildDeps,
): Map<string, ResolvedPiAiProviderProfile> {
  const resolved = new Map<string, ResolvedPiAiProviderProfile>()
  for (const [route, profile] of Object.entries(providers ?? {})) {
    let normalized: NormalizedRoute | undefined
    try {
      normalized = normalizeRoute(route, profile, deps)
      if (normalized === undefined) continue
      const single = deps.kit.resolveProfiles({ [route]: normalized.profile })
      for (const [name, built] of single) {
        // configuredMaxTokens 回填为用户显式集（官方链把物化继承值也计入请求默认 cap，
        // 与插件原语义不符；见文件头"既有缝隙"）。
        resolved.set(name, { ...built, configuredMaxTokens: normalized.configuredMaxTokens })
      }
    } catch (error) {
      if (!deps.lenient) throw error
      deps.warn?.(
        `llm-pi: provider "${route}" 不可服务（${error instanceof Error ? error.message : String(error)}），已跳过注册`,
      )
    }
  }
  return resolved
}

/** settings 写入校验钩子：完整试跑解析，非法配置在写入处拒绝。 */
export function assertServiceable(
  config: { providers?: Record<string, ProviderProfileConfig> },
  deps: BuildDeps,
): void {
  buildProfiles(config.providers, deps)
  // deepseek 路由同样整体验证（严格模式）：写入处拒绝非法配置
  buildDeepseekRoutes(config.providers, deps)
}
