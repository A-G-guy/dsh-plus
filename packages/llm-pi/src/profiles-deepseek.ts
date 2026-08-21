/**
 * deepseek 路由物化：adapter: deepseek 的 provider 配置 → 官方 DeepSeekAdapter
 * 可直接消费的 DeepSeekConnectionOptions。
 *
 * 语义对齐官方 llm-deepseek 的 resolveAdapterOptions，但继承源换为官方内置
 * 目录（catalog/official.ts）：模型条目只写 id 即继承同名官方模型的模态、
 * 像素预算等能力；extends: 'deepseek' 时全量继承官方目录。
 *
 * 物化产物最终再过一遍官方 resolveAdapterOptions 校验/补默认值，等于把
 * 官方插件的配置闸门原样复用；文件通道（Files API 上传、file_id 引用、
 * 失败降级 base64、配额清理）全部在 DeepSeekAdapter 内部，此处只喂配置。
 * @module llm-pi/profiles-deepseek
 */
import type { DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'

import {
  type OfficialModelBase,
  officialBaseUrl,
  officialModelBase,
  officialModelIds,
} from './catalog/official.ts'
import type { ModelEntryConfig, ProviderProfileConfig } from './config.ts'
import type { DshKit } from './resolve-dsh.ts'

export interface BuildDeepseekDeps {
  kit: DshKit
  /** 运行期宽松模式：数据源漂移时跳过 route 并告警，而非抛错弄挂注册循环。 */
  lenient?: boolean
  warn?: (message: string) => void
}

/** 物化产物：route 的展示名与适配器连接事实（注册期事实另见 connection.retryPolicy）。 */
export interface ResolvedDeepseekRoute {
  route: string
  displayName: string
  connection: DeepSeekConnectionOptions
}

/** 报告不可服务的 route，命名出错配置键（与 profiles.ts 的 invalid 同格式）。 */
function invalid(provider: string, detail: string): never {
  throw new Error(`llm-pi: provider "${provider}" ${detail}`)
}

/** pi 专有字段在 deepseek 路由上显式拒绝（静默忽略会让用户误以为生效）。 */
const PI_ONLY_FIELDS = [
  'api',
  'compat',
  'headers',
  'transport',
  'websocketConnectTimeoutMs',
  'thinkingBudgets',
  'cacheRetention',
  'reasoning',
  'defaultInput',
  'maxRequestImageBytes',
  'timeoutMs',
] as const

/** schema 解析会把 dict 字段物化为 {}（schemastery 行为）；空字典视为未配置。 */
function nonEmptyDict(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0
}

/** defaultInput 的 schema 物化默认（['text']）；显式写同值无害，同样视为未配置。 */
function isMaterializedDefaultInput(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'text'
}

function rejectPiOnlyFields(route: string, profile: ProviderProfileConfig): void {
  for (const field of PI_ONLY_FIELDS) {
    const value = profile[field]
    if (value === undefined) continue
    if (field === 'compat' || field === 'headers' || field === 'thinkingBudgets') {
      if (!nonEmptyDict(value)) continue
    } else if (field === 'defaultInput' && isMaterializedDefaultInput(value)) {
      continue
    }
    invalid(route, `的 ${field} 仅 adapter: pi 可用；adapter: deepseek 的 route 请移除该字段`)
  }
}

/** 解析模型条目的官方目录继承 base；extends 仅允许裸 id 或 "deepseek/id"。 */
function resolveOfficialBase(
  route: string,
  entry: ModelEntryConfig,
  deps: BuildDeepseekDeps,
): OfficialModelBase {
  const ref = entry.extends
  if (ref !== undefined) {
    const slash = ref.indexOf('/')
    const source = slash < 0 ? 'deepseek' : ref.slice(0, slash)
    const id = slash < 0 ? ref : ref.slice(slash + 1)
    if (source !== 'deepseek' || id.length === 0 || id.includes('/')) {
      invalid(
        route,
        `model "${entry.id}" 的 extends 引用 ${JSON.stringify(ref)} 非法：` +
          'adapter: deepseek 的路由仅支持 "deepseek/model" 或裸 model id（官方目录）',
      )
    }
    const base = officialModelBase(deps.kit, id)
    if (base === undefined) {
      if (deps.lenient) {
        deps.warn?.(
          `llm-pi: provider "${route}" model "${entry.id}" 的 extends 引用 "${ref}" 在当前官方目录` +
            '未命中；已降级为手写条目',
        )
        return {}
      }
      invalid(route, `model "${entry.id}" 的 extends 引用 "${ref}" 在官方目录中不存在`)
    }
    return base
  }
  // 缺省：同名继承官方目录（未命中即手写条目，缺省值由官方 schema 兜底）
  return officialModelBase(deps.kit, entry.id) ?? {}
}

/** 条目的声明模态；schema 物化的空数组视为"无答案"，交官方继承 base（同 profiles.ts declaredInput）。 */
function declaredModalities(
  configured: readonly ('text' | 'image')[] | undefined,
): ('text' | 'image')[] | undefined {
  return configured === undefined || configured.length === 0 ? undefined : [...configured]
}

/** 物化单个模型目录条目：官方 base 在下，条目显式字段逐字段覆盖。 */
function materializeModel(
  route: string,
  entry: ModelEntryConfig,
  deps: BuildDeepseekDeps,
): Record<string, unknown> {
  if (entry.reasoningEfforts !== undefined || nonEmptyDict(entry.compat)) {
    invalid(route, `model "${entry.id}" 的 reasoningEfforts/compat 仅 adapter: pi 可用`)
  }
  const base = resolveOfficialBase(route, entry, deps)
  const input = declaredModalities(entry.input) ?? base.input
  const imageFields = {
    imagePixelBudget: entry.imagePixelBudget ?? base.imagePixelBudget,
    imageMaxBytes: entry.imageMaxBytes ?? base.imageMaxBytes,
    imageDetail: entry.imageDetail ?? base.imageDetail,
  }
  const acceptsImage = input?.includes('image') ?? false
  if (!acceptsImage && Object.values(imageFields).some((value) => value !== undefined)) {
    invalid(
      route,
      `model "${entry.id}" 未声明 image 模态，不可配置 imagePixelBudget/imageMaxBytes/imageDetail`,
    )
  }
  return {
    id: entry.id,
    ...((entry.name ?? base.name) === undefined ? {} : { name: entry.name ?? base.name }),
    ...((entry.contextWindow ?? base.contextWindow) === undefined
      ? {}
      : { contextWindow: entry.contextWindow ?? base.contextWindow }),
    ...((entry.maxTokens ?? base.maxTokens) === undefined
      ? {}
      : { maxTokens: entry.maxTokens ?? base.maxTokens }),
    ...(input === undefined ? {} : { inputModalities: [...input] }),
    ...(Object.fromEntries(
      Object.entries(imageFields).filter(([, value]) => value !== undefined),
    ) as Record<string, unknown>),
  }
}

/** 物化一个 route 的模型目录；models 缺省时以官方目录全量继承（要求 extends: 'deepseek'）。 */
function materializeModels(
  route: string,
  profile: ProviderProfileConfig,
  deps: BuildDeepseekDeps,
): Record<string, unknown>[] {
  if (profile.models !== undefined && profile.models.length > 0) {
    const seen = new Set<string>()
    return profile.models.map((entry) => {
      if (entry.id.length === 0) invalid(route, '存在空 id 的模型条目')
      if (seen.has(entry.id)) invalid(route, `模型 "${entry.id}" 重复列出`)
      seen.add(entry.id)
      return materializeModel(route, entry, deps)
    })
  }
  if (profile.extends === 'deepseek') {
    return officialModelIds(deps.kit).map((id) => materializeModel(route, { id }, deps))
  }
  invalid(
    route,
    '未配置 models；adapter: deepseek 的 route 可配 extends: deepseek 全量继承官方目录',
  )
}

/** 组装官方 resolveAdapterOptions 的输入：仅放入显式配置的键，其余走官方默认值。 */
function rawAdapterConfig(
  profile: ProviderProfileConfig,
  baseURL: string,
  models: Record<string, unknown>[],
): Record<string, unknown> {
  const passthrough = [
    'apiKeyEnv',
    'thinking',
    'reasoningEffort',
    'streamIdleTimeoutMs',
    'maxRequestFilesBytes',
    'maxInlineRequestImageBytes',
    'maxImagesPerRequest',
    'imageOffloadByteQuantum',
    'inlineImageOffloadByteQuantum',
    'imageOffloadCountQuantum',
    'filesApiTimeoutMs',
    'fileExpiresAfterSeconds',
    'fileRefreshMarginSeconds',
    'retryPolicy',
  ] as const
  const raw: Record<string, unknown> = { baseURL, models }
  for (const key of passthrough) {
    if (profile[key] !== undefined) raw[key] = profile[key]
  }
  if (profile.defaultMaxTokens !== undefined) raw['maxTokens'] = profile.defaultMaxTokens
  if (profile.defaultContextWindow !== undefined) {
    raw['defaultContextWindow'] = profile.defaultContextWindow
  }
  return raw
}

/** 物化单个 deepseek route；lenient 下失败告警并返回 null（调用方跳过注册）。 */
function buildRoute(
  route: string,
  profile: ProviderProfileConfig,
  deps: BuildDeepseekDeps,
): ResolvedDeepseekRoute | null {
  try {
    if (deps.kit.deepseek === undefined) {
      invalid(
        route,
        '使用 adapter: deepseek，但当前运行时套件不含 dsh-llm-deepseek（需 dsh ≥ 0.1.1-rc.2）',
      )
    }
    rejectPiOnlyFields(route, profile)
    if (profile.extends !== undefined && profile.extends !== 'deepseek') {
      invalid(
        route,
        `的 extends ${JSON.stringify(profile.extends)} 非法：adapter: deepseek 仅支持 "deepseek"（官方目录）`,
      )
    }
    if (profile.apiKeyEnv === undefined || profile.apiKeyEnv.length === 0) {
      invalid(route, '需要 apiKeyEnv：DeepSeekAdapter 无环境自发现，凭据引用必须显式配置')
    }
    const baseURL =
      profile.baseURL ?? (profile.extends === 'deepseek' ? officialBaseUrl(deps.kit) : undefined)
    if (baseURL === undefined || baseURL.length === 0) {
      invalid(route, '需要 baseURL（或 extends: deepseek 继承官方端点）')
    }
    const models = materializeModels(route, profile, deps)
    const connection = deps.kit.deepseek.resolveAdapterOptions(
      rawAdapterConfig(profile, baseURL, models) as never,
      undefined,
    )
    return { route, displayName: profile.displayName ?? route, connection }
  } catch (error) {
    if (!deps.lenient) throw error
    deps.warn?.(
      `llm-pi: deepseek route "${route}" 不可服务（${error instanceof Error ? error.message : String(error)}），已跳过注册`,
    )
    return null
  }
}

/**
 * 校验并物化全部 adapter: deepseek 的 route。严格模式任一 route 失败即整体
 * 抛错（settings 写入校验），lenient 模式跳过坏 route（运行期热更新）。
 */
export function buildDeepseekRoutes(
  providers: Record<string, ProviderProfileConfig> | undefined,
  deps: BuildDeepseekDeps,
): Map<string, ResolvedDeepseekRoute> {
  const resolved = new Map<string, ResolvedDeepseekRoute>()
  for (const [route, profile] of Object.entries(providers ?? {})) {
    if ((profile.adapter ?? 'pi') !== 'deepseek') continue
    if (route.length === 0) throw new Error('llm-pi: provider 名不能为空')
    if (profile.displayName !== undefined && profile.displayName.length === 0) {
      invalid(route, 'displayName 为空')
    }
    const built = buildRoute(route, profile, deps)
    if (built !== null) resolved.set(route, built)
  }
  return resolved
}
