/**
 * 官方应急副本的翻译与渲染（纯函数，零 IO）。
 *
 * 产出一份「官方可识别」的 profile patch 覆盖层：把 dsh-plus-llm-pi 的 route
 * 配置改写为官方 `llm-pi-ai` 的 Config 形状，另附一行禁用 dsh-plus-llm-pi 的
 * 覆盖（应用即切换，同名 route 不撞 DUPLICATE_ADAPTER）。写盘、逐 route 官方
 * 校验与状态管理见 official-copy-writer.ts。
 *
 * 三条翻译底线（对旧「出错自动改写」失效教训的根治）：
 * 1. **只产出官方 schema 声明的字段**：route 键集从官方 Config schema 现场推导
 *    （失败回退内置键集），模型条目按 kit.officialModelFields 过滤——官方拒收
 *    的字段根本不出现在副本里；
 * 2. **compat 只留 offer**：withhold 与未知键按生效门控表丢弃（目录继承值可能
 *    携带 withhold 键，写时会被官方拒绝）；
 * 3. **继承全物化**：官方无 extends——模型条目来自 normalizeRoute 的全显式物化
 *    产物（单协议、单端点约束由该链保证，无需拆分 route）。
 *
 * deepseek 路由改写为 openai-completions（中继网关本就是 OpenAI 兼容面）：
 * 文件通道与思考配置不迁移（官方 llm-pi-ai 无对应字段/无逐模型 reasoningEfforts），
 * 以 warning 明示，绝不静默丢弃。
 * @module llm-pi/official-copy
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { DeepSeekCatalogModel } from '@deepseek-ai/dsh-llm-deepseek'
import type { PiAiModelProfile, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { stringify } from 'yaml'

import { compatDispositionOf } from './compat.ts'
import type { ProviderProfileConfig } from './config.ts'
import type { SchemaNode } from './official-surface.ts'
import { isDraftRoute } from './profiles.ts'
import type { ResolvedDeepseekRoute } from './profiles-deepseek.ts'
import type { OfficialConfigSchema } from './resolve-dsh.ts'

/** 副本文件在 Harness home（.dsh）根目录的落点；lifeboat 面板按同一路径消费（文件契约）。 */
export const OFFICIAL_COPY_PATH = dshHomePath('llm-pi.official-patch.yaml')

/** deepseek 路由改写所用线协议：中继网关对外提供 OpenAI 兼容 chat completions 面。 */
export const DEEPSEEK_COPY_API = 'openai-completions'

/**
 * 官方 Config schema 布局不可识别时的 route 字段兜底（官方 PiAiProviderProfile
 * 最后已知键集）。与官方新增字段的失配只表现为「新字段不进副本」，不弄挂生成。
 */
export const FALLBACK_ROUTE_FIELDS = [
  'apiKeyEnv',
  'displayName',
  'api',
  'baseURL',
  'models',
  'modelOverrides',
  'compat',
  'defaultContextWindow',
  'defaultMaxTokens',
  'defaultInput',
  'headers',
  'reasoning',
  'thinkingBudgets',
  'cacheRetention',
  'transport',
  'timeoutMs',
  'websocketConnectTimeoutMs',
  'streamIdleTimeoutMs',
  'maxRequestImageBytes',
  'requestImagePixelBudget',
  'requestImageMaxBytes',
  'retryPolicy',
] as const

/** deepseek 专有且官方 llm-pi-ai 无对应字段的 raw 键（出现即记 warning）。 */
const DEEPSEEK_UNMIGRATED_FIELDS = [
  'thinking',
  'reasoningEffort',
  'maxRequestFilesBytes',
  'filesApiTimeoutMs',
  'fileExpiresAfterSeconds',
  'fileRefreshMarginSeconds',
  'maxImagesPerRequest',
  'imageOffloadByteQuantum',
  'inlineImageOffloadByteQuantum',
  'imageOffloadCountQuantum',
] as const

/**
 * 从官方 Config schema 推导 route 字段键集（`providers.*` 的 dict 键）；
 * 布局不可识别/键集为空返回 undefined，调用方回退内置键集并告警。
 */
export function deriveOfficialRouteFields(config: OfficialConfigSchema): string[] | undefined {
  const fields = (config as unknown as SchemaNode).dict?.['providers']?.inner?.dict
  if (fields === undefined) return undefined
  const keys = Object.keys(fields)
  return keys.length > 0 ? keys : undefined
}

/** compat 过滤：只保留该协议 offer 的字段（withhold/未知键丢弃）；无保留项返回 undefined。 */
function offerCompat(
  api: string,
  compat: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (compat === undefined || typeof compat !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(compat)) {
    if (value === undefined || value === null) continue
    if (compatDispositionOf(api, field) === 'offer') out[field] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 单个模型条目 → 官方键集内的条目（compat 另过 offer 门控）。 */
function filterModel(
  api: string,
  model: PiAiModelProfile,
  modelFields: readonly string[],
): Record<string, unknown> {
  const source = model as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of modelFields) {
    const value = source[key]
    if (value === undefined) continue
    if (key === 'compat') {
      const compat = offerCompat(api, value as Record<string, unknown>)
      if (compat !== undefined) out.compat = compat
      continue
    }
    out[key] = value
  }
  return out
}

/** 归一化 profile → 官方 route 字段内的条目（models 逐条过滤）。 */
function filterRoute(
  profile: PiAiProviderProfile,
  routeFields: readonly string[],
  modelFields: readonly string[],
): Record<string, unknown> {
  const source = profile as unknown as Record<string, unknown>
  const api = typeof source['api'] === 'string' ? source['api'] : ''
  const out: Record<string, unknown> = {}
  for (const key of routeFields) {
    const value = source[key]
    if (value === undefined) continue
    if (key === 'models') {
      const models = Array.isArray(value) ? (value as PiAiModelProfile[]) : []
      out.models = models.map((model) => filterModel(api, model, modelFields))
      continue
    }
    out[key] = value
  }
  return out
}

/** deepseek 单模型 → 官方条目（inputModalities 改名 input；图像预算不迁移）。 */
function deepseekModelEntry(model: DeepSeekCatalogModel): Record<string, unknown> {
  const out: Record<string, unknown> = { id: model.id }
  if (model.name !== undefined) out.name = model.name
  if (model.contextWindow !== undefined) out.contextWindow = model.contextWindow
  if (model.maxTokens !== undefined) out.maxTokens = model.maxTokens
  if (model.inputModalities !== undefined) out.input = [...model.inputModalities]
  return out
}

interface DeepseekCopyResult {
  profile: Record<string, unknown>
  /** 未迁移的字段名（出现即入副本头 warning，绝不静默丢弃）。 */
  unmirrored: string[]
}

/**
 * deepseek 路由 → 官方 llm-pi-ai profile：连接事实取 resolveAdapterOptions 的
 * 校验产物（端点/凭据引用/限额），模型取官方目录物化结果。思考配置与文件通道
 * 字段不迁移（llm-pi-ai 无对应语义），逐项列入 unmirrored。
 */
function deepseekCopyProfile(
  raw: ProviderProfileConfig,
  resolved: ResolvedDeepseekRoute,
): DeepseekCopyResult {
  const connection = resolved.connection
  const unmirrored: string[] = DEEPSEEK_UNMIGRATED_FIELDS.filter((key) => raw[key] !== undefined)
  if (raw.models?.some((m) => m.imagePixelBudget !== undefined || m.imageMaxBytes !== undefined))
    unmirrored.push('模型级 imagePixelBudget/imageMaxBytes')
  const profile: Record<string, unknown> = {
    displayName: resolved.displayName,
    api: DEEPSEEK_COPY_API,
    baseURL: connection.baseURL,
    apiKeyEnv: raw.apiKeyEnv,
    defaultContextWindow: connection.defaultContextWindow,
    defaultMaxTokens: connection.maxTokens,
    streamIdleTimeoutMs: connection.streamIdleTimeoutMs,
    models: connection.models.map(deepseekModelEntry),
  }
  if (raw.retryPolicy !== undefined) profile.retryPolicy = raw.retryPolicy
  // 语义对应：deepseek 的 base64 降级后载荷上限 ↔ llm-pi-ai 的单请求 base64 上限。
  if (raw.maxInlineRequestImageBytes !== undefined) {
    profile.maxRequestImageBytes = connection.maxInlineRequestImageBytes
  }
  return { profile, unmirrored }
}

/** 翻译输入：运行期物化产物 + 原始配置 + 官方生效的手写条目。 */
export interface OfficialCopyInput {
  /** 本插件当前原始配置（不受 enabled 影响——副本是配置层事实）。 */
  providers: Record<string, ProviderProfileConfig>
  /** normalizeOfficialRoutes 产物：pi route 的官方形状物化结果。 */
  normalizedPi: ReadonlyMap<string, PiAiProviderProfile>
  /** buildDeepseekRoutes 产物：deepseek route 的连接事实。 */
  deepseekResolved: ReadonlyMap<string, ResolvedDeepseekRoute>
  /** 官方 llm-pi-ai 生效 providers（settings describe 视图，含 profile 手写条目）。 */
  manualProviders: Record<string, unknown> | undefined
  /** 官方 route 字段键集（deriveOfficialRouteFields / FALLBACK_ROUTE_FIELDS）。 */
  routeFields: readonly string[]
  /** 官方模型条目字段键集（kit.officialModelFields，现场推导）。 */
  modelFields: readonly string[]
}

export interface OfficialCopy {
  /** route 键 → 官方 profile（已过滤；手写条目覆盖同名 key）。空 = 空补丁。 */
  providers: Record<string, unknown>
  /** 生成期警告（渲染进副本头注释，也进配置卡诊断）。 */
  warnings: string[]
}

/** 翻译整份配置为官方副本内容（纯函数；坏 route 的跳过告警由上游 warn 通道汇集）。 */
export function buildOfficialCopy(input: OfficialCopyInput): OfficialCopy {
  const warnings: string[] = []
  const providers: Record<string, unknown> = {}
  for (const [route, raw] of Object.entries(input.providers)) {
    if ((raw.adapter ?? 'pi') === 'deepseek') {
      const resolved = input.deepseekResolved.get(route)
      if (resolved === undefined) continue // 物化失败：buildDeepseekRoutes 已告警
      const { profile, unmirrored } = deepseekCopyProfile(raw, resolved)
      providers[route] = profile
      if (unmirrored.length > 0) {
        warnings.push(
          `deepseek route "${route}" 的字段未迁移到 llm-pi-ai：${unmirrored.join('、')}`,
        )
      }
      continue
    }
    const normalized = input.normalizedPi.get(route)
    if (normalized === undefined) {
      // 物化失败的 route 由 normalizeOfficialRoutes 的 warn 通道报告；草稿
      // （未配置模型的占位）本就不可服务，在此补一条可读说明。
      if (isDraftRoute(raw)) warnings.push(`草稿 route "${route}" 未纳入副本（尚无模型）`)
      continue
    }
    providers[route] = filterRoute(normalized, input.routeFields, input.modelFields)
  }
  // 手写官方条目（describe 的生效视图）同名 key 手写优先：那是用户的显式意图。
  for (const [route, profile] of Object.entries(input.manualProviders ?? {})) {
    if (profile !== null && typeof profile === 'object') providers[route] = profile
  }
  return { providers, warnings }
}

/** 渲染元数据（头注释里的应用指引）。 */
export interface OfficialCopyMeta {
  /** 来源 profile 名（缺省以占位符渲染应用命令）。 */
  profile: string | undefined
}

/** 头注释：用途、两种应用方式、切换语义、回退方法与警告清单（确定性输出，mtime 即生成时间）。 */
function renderHeader(copy: OfficialCopy, meta: OfficialCopyMeta): string {
  const profile = meta.profile ?? '<profile>'
  return [
    '# 官方应急 LLM 配置副本 —— @dsh-plus/llm-pi 自动生成（勿手改：下次配置变更会被覆盖；文件 mtime 即最近生成时间）',
    `# 来源 profile：${profile}`,
    '# 用途：dsh-plus-llm-pi 缺席/故障时，用本文件把其 route 以官方 llm-pi-ai 配置恢复 LLM 能力。',
    '# 应用（二选一，重启/重载后生效）：',
    `#   1) 单次启动：dsh ${profile} --patch ${OFFICIAL_COPY_PATH}`,
    `#   2) 长期生效：把本文件条目并入该 profile 的 cordis.patch.yml（~/.dsh/profiles/${profile}/）`,
    '# 语义：应用即切换 —— 副本禁用 dsh-plus-llm-pi，并整行替换 llm-pi-ai 的 config',
    '#       （官方 llm-pi-ai 现有 providers 已合并保留；同名 key 以手写条目优先）。',
    '# 回退：移除 --patch 参数或删除并入的条目（含 dsh-plus-llm-pi 的 disabled 行），重启/重载。',
    `# 本次内容：${Object.keys(copy.providers).length} 个官方 provider route。`,
    ...copy.warnings.map((warning) => `# 警告：${warning}`),
  ].join('\n')
}

/**
 * 渲染副本文件内容（确定性：同输入同字节，mtime 承载时间语义）。
 * 零 route 时渲染空补丁列表 `[]`（应用无效果）——绝不产出「只禁用不供给」的误导性副本。
 */
export function renderOfficialCopy(copy: OfficialCopy, meta: OfficialCopyMeta): string {
  const header = renderHeader(copy, meta)
  if (Object.keys(copy.providers).length === 0) {
    return `${header}\n# 当前没有可迁移的 route（llm-pi 未配置或全部不可服务），空补丁应用无效果。\n[]\n`
  }
  const rows = [
    { id: 'dsh-plus-llm-pi', disabled: true },
    { id: 'llm-pi-ai', config: { providers: copy.providers } },
  ]
  return `${header}\n${stringify(rows, { lineWidth: 0 })}`
}
