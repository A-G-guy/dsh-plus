/**
 * profile 构建器：插件 Config → ResolvedPiAiProviderProfile 映射。
 *
 * 语义与官方 dsh-llm-pi-ai 的 resolveProfiles 链逐点对齐（index.js:1068-1471），
 * 差异仅在两点扩展：
 * - base 来源从"route 同名内置目录"换为 extends 三级数据源（inherit.ts）；
 * - compat 从 2 字段枚举扩展为逐协议全量字段（compat.ts），写入即校验。
 *
 * 产物经 `new PiAiAdapter({ profiles })` 进入官方消息链路；
 * 任何不可服务的配置在此处抛错（命名 route/model），配合 settings 写入校验，
 * 非法配置在写入时被拒绝、运行期保留上一份好配置。
 * @module llm-pi/profiles
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'

import { inheritedCatalogEntries, builtinProviderBaseUrl, type ModelBase } from './catalog/builtin.ts'
import type { ModelsDevSource } from './catalog/models-dev.ts'
import { mergeCompat, validateCompat } from './compat.ts'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  MAX_TIMER_DELAY_MS,
  THINKING_LEVELS,
  type ModelEntryConfig,
  type ProviderProfileConfig,
} from './config.ts'
import { ExtendsError, resolveModelBase } from './inherit.ts'
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
function declaredInput(configured: readonly ('text' | 'image')[] | undefined): ('text' | 'image')[] | undefined {
  return configured === undefined || configured.length === 0 ? undefined : [...configured]
}

/**
 * 单个模型的 reasoning 物化（逐行对齐官方 resolveModelReasoning）：
 * 显式 dict → 全档位确定的 thinkingLevelMap（未声明档位置 null）；
 * false → 非推理模型；缺省 → 保留继承源的 reasoning 能力。
 */
function resolveModelReasoning(
  provider: string,
  entry: ModelEntryConfig,
  base: ModelBase,
): { reasoning: boolean; thinkingLevelMap?: Record<string, string | null> } {
  const efforts = entry.reasoningEfforts
  if (efforts === undefined) {
    if (base.reasoning === undefined) return { reasoning: false }
    return {
      reasoning: base.reasoning,
      ...(base.thinkingLevelMap === undefined
        ? {}
        : { thinkingLevelMap: base.thinkingLevelMap as Record<string, string | null> }),
    }
  }
  if (efforts === false) return { reasoning: false }
  if (Object.keys(efforts).length === 0) {
    invalid(provider, `model "${entry.id}" 的 reasoningEfforts 为空：声明档位、置 false 或缺省继承`)
  }
  for (const level of THINKING_LEVELS) {
    const wire = (efforts as Record<string, string | null | undefined>)[level]
    if (wire === undefined) continue
    if (wire === null) {
      if (level !== 'off') invalid(provider, `model "${entry.id}" reasoningEfforts.${level} 需要线值；仅 off 可留空`)
    } else if (wire.length === 0) {
      invalid(provider, `model "${entry.id}" reasoningEfforts.${level} 不能为空字符串`)
    }
  }
  const declared = THINKING_LEVELS.filter((level) => (efforts as Record<string, unknown>)[level] !== undefined)
  if (!declared.some((level) => level !== 'off')) {
    invalid(provider, `model "${entry.id}" reasoningEfforts 只有 off；声明思考档位或置 false`)
  }
  const map: Record<string, string | null> = {}
  for (const level of THINKING_LEVELS) {
    const wire = (efforts as Record<string, string | null | undefined>)[level]
    if (wire === undefined) map[level] = null
    else if (wire !== null) map[level] = wire
  }
  return { reasoning: true, thinkingLevelMap: map }
}

/** Harness 自管凭据的 api-key auth（对齐官方 harnessApiKeyAuth，index.js:1215）。 */
function harnessApiKeyAuth(name: string) {
  return {
    name,
    resolve: ({ credential }: { credential?: { key?: string } }) =>
      Promise.resolve({ auth: credential?.key === undefined ? {} : { apiKey: credential.key }, source: name }),
  }
}

interface MaterializedModel {
  id: string
  name: string
  api: string
  provider: string
  baseUrl: string
  reasoning: boolean
  thinkingLevelMap?: Record<string, string | null>
  input: ('text' | 'image')[]
  cost: typeof NO_COST
  contextWindow: number
  maxTokens: number
  headers?: Record<string, string>
  compat?: Record<string, unknown>
}

/** 物化单个模型：继承 base 在下，条目显式字段逐字段覆盖。lenient 下缺 api/baseURL 时跳过（返回 null）。 */
function materializeModel(
  route: string,
  profile: ProviderProfileConfig,
  entry: ModelEntryConfig,
  base: ModelBase,
  routeApi: string | undefined,
  providerBaseUrl: string | undefined,
  defaultInput: ('text' | 'image')[],
  deps: BuildDeps,
  configuredMaxTokens: Map<string, number>,
): MaterializedModel | null {
  const api = profile.api ?? base.api ?? routeApi
  if (api === undefined) {
    if (deps.lenient) {
      deps.warn?.(`llm-pi: provider "${route}" model "${entry.id}" 无法获得 api（继承源缺失），已跳过该模型`)
      return null
    }
    invalid(route, `model "${entry.id}" 需要 api：继承源未提供，请在 route 上设置 api`)
  }
  const baseUrl = profile.baseURL ?? base.baseUrl ?? providerBaseUrl
  if (baseUrl === undefined) {
    if (deps.lenient) {
      deps.warn?.(`llm-pi: provider "${route}" model "${entry.id}" 无法获得 baseURL（继承源缺失），已跳过该模型`)
      return null
    }
    invalid(route, `model "${entry.id}" 需要 baseURL：继承源未提供，请在 route 上设置 baseURL`)
  }
  const contextWindow = entry.contextWindow ?? base.contextWindow ?? profile.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  const maxTokens = entry.maxTokens ?? base.maxTokens ?? profile.defaultMaxTokens ?? DEFAULT_MAX_TOKENS
  if (entry.maxTokens !== undefined) configuredMaxTokens.set(entry.id, entry.maxTokens)
  validateCompat(api, profile.compat as Record<string, unknown> | undefined, `provider "${route}"`)
  validateCompat(api, entry.compat as Record<string, unknown> | undefined, `provider "${route}" model "${entry.id}"`)
  const compat = mergeCompat(
    base.api === api ? base.compat : undefined,
    profile.compat as Record<string, unknown> | undefined,
    entry.compat as Record<string, unknown> | undefined,
  )
  return {
    id: entry.id,
    name: entry.name ?? base.name ?? entry.id,
    api,
    provider: route,
    baseUrl,
    ...resolveModelReasoning(route, entry, base),
    input: declaredInput(entry.input) ?? base.input ?? [...defaultInput],
    cost: base.cost ?? NO_COST,
    contextWindow,
    maxTokens,
    ...(base.headers === undefined ? {} : { headers: { ...base.headers } }),
    ...(compat === undefined ? {} : { compat }),
  }
}

/** 物化一个 route 的全部模型；返回模型列表与显式配置的请求 cap 表。
 *  lenient 下 route 无任何可服务模型时返回 null（调用方跳过该 route）。 */
function materializeRouteModels(
  route: string,
  profile: ProviderProfileConfig,
  deps: BuildDeps,
  defaultInput: ('text' | 'image')[],
): { models: MaterializedModel[]; configuredMaxTokens: Map<string, number> } | null {
  const configuredMaxTokens = new Map<string, number>()
  const providerBaseUrl =
    profile.extends === undefined ? undefined : builtinProviderBaseUrl(deps.kit, profile.extends)
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
  const models = entries
    .map(({ id, entry, base }) =>
      materializeModel(
        route,
        profile,
        entry ?? { id },
        base,
        routeApi,
        providerBaseUrl,
        defaultInput,
        deps,
        configuredMaxTokens,
      ),
    )
    .filter((model): model is MaterializedModel => model !== null)
  if (models.length === 0) {
    if (deps.lenient) {
      deps.warn?.(`llm-pi: provider "${route}" 当前没有可服务的模型（继承源漂移），已跳过该 route 的注册`)
      return null
    }
    invalid(route, 'route 内没有可服务的模型')
  }
  const finalApis = new Set(models.map((m) => m.api))
  if (finalApis.size > 1) {
    invalid(route, `route 内模型协议不一致（${[...finalApis].join(', ')}）；一个 route 只能服务一种协议`)
  }
  return { models, configuredMaxTokens }
}

/**
 * 校验并物化全部 route。任一 route 不可服务即整体抛错——
 * settings 写入校验与运行期 profiles 回调共用本函数，
 * 保证"写入时被拒"与"运行期不可能拿到坏配置"互为表里。
 */
export function buildProfiles(
  providers: Record<string, ProviderProfileConfig> | undefined,
  deps: BuildDeps,
): Map<string, ResolvedPiAiProviderProfile> {
  const resolved = new Map<string, ResolvedPiAiProviderProfile>()
  for (const [route, profile] of Object.entries(providers ?? {})) {
    if (route.length === 0) throw new Error('llm-pi: provider 名不能为空')
    // 注意：不做"route 名与内置 provider 名重名"的静态校验——内置名 ≠ 已注册
    // route（如官方 llm-pi-ai 配置清空后 anthropic 名可用）。真实冲突只在注册期
    // 暴露（DUPLICATE_ADAPTER），由 service 层逐个 route 注册降级处理。
    if (profile.baseURL !== undefined && profile.baseURL.length === 0) invalid(route, 'baseURL 为空')
    if (profile.displayName !== undefined && profile.displayName.length === 0) invalid(route, 'displayName 为空')
    const streamIdleTimeoutMs = profile.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
    if (
      !Number.isFinite(streamIdleTimeoutMs) ||
      streamIdleTimeoutMs <= 0 ||
      streamIdleTimeoutMs > MAX_TIMER_DELAY_MS
    ) {
      invalid(route, `streamIdleTimeoutMs 必须是 (0, ${MAX_TIMER_DELAY_MS}] 内的有限数`)
    }
    const defaultInput = [...(profile.defaultInput ?? ['text'])] as ('text' | 'image')[]
    if (defaultInput.length === 0) invalid(route, 'defaultInput 至少要声明一种模态')
    const displayName = profile.displayName ?? route
    const catalog = materializeRouteModels(route, profile, deps, defaultInput)
    if (catalog === null) continue // lenient 下 route 无模型可服务，跳过注册
    const api = catalog.models[0]?.api
    const factory = api === undefined ? undefined : deps.kit.protocolFactories[api as keyof DshKit['protocolFactories']]
    if (factory === undefined) {
      invalid(route, `api ${JSON.stringify(api)} 本插件无法服务（支持：openai-completions/openai-responses/anthropic-messages）`)
    }
    const piProvider = deps.kit.createProvider({
      id: route,
      name: displayName,
      ...(profile.baseURL === undefined
        ? profile.extends === undefined
          ? {}
          : { baseUrl: builtinProviderBaseUrl(deps.kit, profile.extends) }
        : { baseUrl: profile.baseURL }),
      ...(profile.headers === undefined ? {} : { headers: { ...profile.headers } }),
      auth: { apiKey: harnessApiKeyAuth(displayName) },
      models: catalog.models,
      api: factory() as never,
    })
    resolved.set(route, {
      provider: route,
      displayName,
      ...(profile.apiKeyEnv === undefined ? {} : { apiKeyEnv: credentialRef(profile.apiKeyEnv) }),
      streamIdleTimeoutMs,
      retryPolicy: deps.kit.resolveRetryPolicy(
        profile.retryPolicy as Parameters<DshKit['resolveRetryPolicy']>[0],
        `llm-pi: provider "${route}" retryPolicy`,
      ),
      ...(profile.headers === undefined ? {} : { headers: { ...profile.headers } }),
      ...(profile.reasoning === undefined ? {} : { reasoning: profile.reasoning }),
      ...(profile.thinkingBudgets === undefined ? {} : { thinkingBudgets: { ...profile.thinkingBudgets } }),
      ...(profile.cacheRetention === undefined ? {} : { cacheRetention: profile.cacheRetention }),
      ...(profile.transport === undefined ? {} : { transport: profile.transport }),
      ...(profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs }),
      ...(profile.websocketConnectTimeoutMs === undefined
        ? {}
        : { websocketConnectTimeoutMs: profile.websocketConnectTimeoutMs }),
      configuredMaxTokens: catalog.configuredMaxTokens,
      piProvider,
    } as ResolvedPiAiProviderProfile)
  }
  return resolved
}

/** settings 写入校验钩子：完整试跑解析，非法配置在写入处拒绝。 */
export function assertServiceable(
  config: { providers?: Record<string, ProviderProfileConfig> },
  deps: BuildDeps,
): void {
  buildProfiles(config.providers, deps)
}
