/**
 * LLM 应急翻译：默认模型路由的 provider 无已注册 adapter 时（典型场景：llm-pi
 * 被隔离/加载失败），把 settings.yaml 里 dsh-plus-llm-pi 的 provider 配置翻译为
 * 官方 llm-pi-ai 命名空间的原生格式（键加 -fb 后缀避开 DUPLICATE_ADAPTER 冲突），
 * 默认模型指到翻译路由；源 provider 恢复健康后按 journal 自动还原。
 *
 * 为什么读原始 settings.yaml 而不是 settings 服务：插件被禁用后其命名空间随之
 * 注销，服务层读不到——但数据仍在文件里（只读，不修改）。
 * 降级语义：翻译只覆盖官方物化的字段子集，dsh-plus 扩展的全量 compat 丢弃；
 * 协议推断是启发式（显式 api > 路由名 > 模型继承源 > openai-completions 兜底）。
 * @module lifeboat/fallback-llm
 */
import { readFile } from 'node:fs/promises'

import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-llm'
import { SettingsConflictError, type SettingsProvider } from '@deepseek-ai/dsh-settings'
import { parseDocument } from 'yaml'

import type { FallbackStateT } from './config.ts'
import type { Alerter } from './notify.ts'

// 0.1.2-alpha.2 起 settings 命名空间直接以字面量使用（编译期校验语法），
// 不再需要 settingsNamespace() 品牌化。
const NS_PI_AI = 'llm-pi-ai'
const NS_AGENT_DEFAULT = 'agent-default-model'
const RAW_NS_LLM_PI = 'dsh-plus-llm-pi'

/** 翻译路由键后缀：与源路由错开，避免 llm-pi 恢复瞬间撞 DUPLICATE_ADAPTER。 */
export const FALLBACK_SUFFIX = '-fb'

/** 官方配置路径物化的 compat 子集（其余字段降级期丢弃）。 */
const COMPAT_WHITELIST = ['thinkingFormat', 'supportsReasoningEffort'] as const

/**
 * master 官方 llm-pi-ai 的 COMPAT_GATES（llm-pi-ai/src/catalog.ts）：每个 compat
 * 字段按协议门控，写时经 assertOfferedCompatFields 拒绝不适配字段——thinkingFormat /
 * supportsReasoningEffort 仅 openai-completions 提供。翻译按推断 api 过滤，避免
 * 整段 compat 写入被官方校验拒绝。
 */
const COMPAT_OFFER_APIS: Readonly<Record<string, ReadonlySet<string>>> = {
  thinkingFormat: new Set(['openai-completions']),
  supportsReasoningEffort: new Set(['openai-completions']),
}

/** 官方 reasoning 词表（ModelThinkingLevel 的保守子集），不在其中的值丢弃。 */
const REASONING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** dsh-plus-llm-pi provider 配置的松散视图（原始文件读取，未经 schema 解析）。 */
export interface RawProvider {
  displayName?: string
  apiKeyEnv?: string
  baseURL?: string
  api?: string
  headers?: Record<string, string>
  reasoning?: string
  thinkingBudgets?: Record<string, unknown>
  defaultInput?: string[]
  compat?: Record<string, unknown>
  models?: RawModel[]
}

export interface RawModel {
  id: string
  name?: string
  extends?: string
  contextWindow?: number
  maxTokens?: number
  input?: string[]
  reasoningEfforts?: Record<string, string>
}

/** 官方 llm-pi-ai provider 档案的翻译目标形状（字段子集）。 */
export interface TranslatedProvider {
  displayName?: string
  apiKeyEnv?: string
  baseURL?: string
  api: string
  headers?: Record<string, string>
  reasoning?: string
  thinkingBudgets?: Record<string, unknown>
  defaultInput?: string[]
  compat?: Record<string, unknown>
  models?: Record<string, unknown>[]
}

/** 模型继承源（extends 的 provider 前缀）→ 协议的已知映射。 */
const EXTENDS_PROTOCOL: Record<string, string> = {
  anthropic: 'anthropic-messages',
  'kimi-coding': 'anthropic-messages',
  deepseek: 'openai-completions',
  openai: 'openai-completions',
}

/** 路由名里的协议线索。 */
const ROUTE_PROTOCOL: Record<string, string> = {
  chat: 'openai-completions',
  completions: 'openai-completions',
  response: 'openai-responses',
  responses: 'openai-responses',
  anthropic: 'anthropic-messages',
  claude: 'anthropic-messages',
}

/**
 * 推断路由协议：显式 api > 路由名线索 > 首个模型的继承源 > openai-completions。
 * 兜底选 openai-completions 因为多数网关提供 OpenAI 兼容面；推错时告警里注明。
 */
export function inferApi(routeKey: string, provider: RawProvider): string {
  if (typeof provider.api === 'string' && provider.api.length > 0) return provider.api
  const routeHint = ROUTE_PROTOCOL[routeKey.toLowerCase()]
  if (routeHint !== undefined) return routeHint
  const firstExtends = provider.models?.find((m) => typeof m.extends === 'string')?.extends
  const source = firstExtends?.split('/')[0]
  if (source !== undefined && EXTENDS_PROTOCOL[source] !== undefined)
    return EXTENDS_PROTOCOL[source]
  return 'openai-completions'
}

/** 单个 provider 翻译（纯函数）。 */
export function translateProvider(routeKey: string, raw: RawProvider): TranslatedProvider {
  const out: TranslatedProvider = {
    displayName: `${raw.displayName ?? routeKey} [fallback]`,
    api: inferApi(routeKey, raw),
  }
  if (raw.apiKeyEnv !== undefined) out.apiKeyEnv = raw.apiKeyEnv
  if (raw.baseURL !== undefined) out.baseURL = raw.baseURL
  if (raw.headers !== undefined) out.headers = raw.headers
  if (raw.reasoning !== undefined && REASONING_LEVELS.has(raw.reasoning))
    out.reasoning = raw.reasoning
  if (raw.thinkingBudgets !== undefined) out.thinkingBudgets = raw.thinkingBudgets
  if (Array.isArray(raw.defaultInput) && raw.defaultInput.length > 0)
    out.defaultInput = raw.defaultInput
  if (raw.compat !== undefined) {
    const api = inferApi(routeKey, raw)
    const compat: Record<string, unknown> = {}
    for (const key of COMPAT_WHITELIST) {
      const value = raw.compat[key]
      // 空值同样丢弃：官方写时拒绝 valueless 键（catalog.ts assertOfferedCompatFields）
      if (value === undefined || value === null) continue
      // 按推断 api 门控：仅写入该协议 offer 的字段，其余丢弃（官方写时拒绝不适配字段）
      if (!COMPAT_OFFER_APIS[key]?.has(api)) continue
      compat[key] = value
    }
    if (Object.keys(compat).length > 0) out.compat = compat
  }
  if (Array.isArray(raw.models) && raw.models.length > 0) {
    out.models = raw.models.map((m) => {
      const model: Record<string, unknown> = { id: m.id }
      if (m.name !== undefined) model.name = m.name
      if (m.contextWindow !== undefined) model.contextWindow = m.contextWindow
      if (m.maxTokens !== undefined) model.maxTokens = m.maxTokens
      if (Array.isArray(m.input) && m.input.length > 0) model.input = m.input
      return model
    })
  }
  return out
}

/** 整表翻译：键加 -fb 后缀（纯函数）。 */
export function translateProviders(
  providers: Record<string, RawProvider>,
): Record<string, TranslatedProvider> {
  const out: Record<string, TranslatedProvider> = {}
  for (const [key, raw] of Object.entries(providers)) {
    out[`${key}${FALLBACK_SUFFIX}`] = translateProvider(key, raw)
  }
  return out
}

/** 读 settings.yaml 原始文档的指定段落（只读；文件/段落缺失返回 undefined）。 */
export async function readRawSection(
  settingsFile: string,
  ns: string,
): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(settingsFile, 'utf-8')
  const doc = parseDocument(text).toJS() as Record<string, unknown>
  const section = doc[ns]
  if (typeof section !== 'object' || section === null) return undefined
  return section as Record<string, unknown>
}

interface SettingsWrite {
  update(ns: string, patch: object): Promise<void>
  mutate(
    ns: string,
    ops: readonly {
      op: 'set' | 'unset'
      path: readonly string[]
      value?: unknown
    }[],
  ): Promise<void>
}

/** 写 settings 带一次冲突重试（用户同时改配置时不抢，放弃并告警）。 */
async function writeWithRetry(write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (error) {
    if (!(error instanceof SettingsConflictError)) throw error
    await write()
  }
}

export interface FallbackDeps {
  journal: (kind: string, detail: string) => void
  alert: Alerter
  /** 持久化翻译状态（journal 命名空间内）。 */
  readState(): FallbackStateT | null
  writeState(state: FallbackStateT | null): Promise<void>
}

/** 装配 LLM 应急翻译：启动后及 settings/llm 变化时评估一次（并发合并）。 */
export function installLlmFallback(ctx: Context, deps: FallbackDeps): void {
  const logger = ctx.logger('lifeboat')
  const settings = ctx.settings as SettingsProvider
  const writes = settings as unknown as SettingsWrite
  const settingsFile = dshHomePath('settings.yaml')
  let inFlight: Promise<void> | undefined

  const listProviderIds = (): Set<string> => new Set(ctx.llm.listProviders().map((p) => p.id))

  async function activate(provider: string, model: string): Promise<void> {
    const section = await readRawSection(settingsFile, RAW_NS_LLM_PI).catch(() => undefined)
    const providers = section?.providers as Record<string, RawProvider> | undefined
    if (providers === undefined || providers[provider] === undefined) {
      deps.alert(
        '[DSH] 默认模型不可用且无配置可翻译',
        `默认模型的 provider "${provider}" 没有已注册 adapter，且 ${RAW_NS_LLM_PI} 配置中找不到对应条目，无法应急翻译。请手动修复。`,
      )
      return
    }
    const translated = translateProviders(providers)
    const fbProvider = `${provider}${FALLBACK_SUFFIX}`
    try {
      // 官方 llm-pi-ai 的 installSection 注册了 validate（assertServiceable），
      // 写时拒绝不适配的翻译结果；update 无 expectedRevision 本就无条件写，不做冲突
      // 重试——失败一律分类为「翻译失败」。
      await writes.update(NS_PI_AI, { providers: translated })
      await writes.update(NS_AGENT_DEFAULT, { provider: fbProvider, model })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`翻译失败（官方 llm-pi-ai 拒绝写入翻译后的配置）: ${message}`)
    }
    await deps.writeState({
      active: true,
      originalProvider: provider,
      originalModel: model,
      fallbackProvider: fbProvider,
      providers: Object.keys(translated),
      at: new Date().toISOString(),
    })
    deps.journal(
      'llm-fallback',
      `默认模型切换到 ${fbProvider}/${model}（翻译 ${Object.keys(translated).length} 个 provider）`,
    )
    deps.alert(
      '[DSH] LLM 配置已应急翻译',
      `默认模型的 provider "${provider}" 不可用（llm-pi 缺席？），已把 ${RAW_NS_LLM_PI} 配置翻译为官方 llm-pi-ai 路由（-fb 后缀）并切换默认模型为 ${fbProvider}/${model}。源插件恢复后将自动还原。`,
    )
  }

  async function revert(state: FallbackStateT): Promise<void> {
    const ops = state.providers.map((key) => ({
      op: 'unset' as const,
      path: ['providers', key],
    }))
    await writeWithRetry(() => writes.mutate(NS_PI_AI, ops))
    await writeWithRetry(() =>
      writes.update(NS_AGENT_DEFAULT, {
        provider: state.originalProvider,
        model: state.originalModel,
      }),
    )
    await deps.writeState(null)
    deps.journal(
      'llm-fallback-revert',
      `默认模型还原为 ${state.originalProvider}/${state.originalModel}`,
    )
    deps.alert(
      '[DSH] LLM 应急翻译已还原',
      `provider "${state.originalProvider}" 恢复健康，默认模型已还原，临时翻译路由已清除。`,
    )
  }

  async function evaluate(): Promise<void> {
    const state = deps.readState()
    const ids = listProviderIds()
    if (state?.active) {
      if (ids.has(state.originalProvider)) await revert(state)
      return
    }
    const def = ctx.settings.get(NS_AGENT_DEFAULT) as
      | { provider?: string; model?: string }
      | undefined
    if (def?.provider === undefined || def.model === undefined) return
    if (ids.has(def.provider)) return
    await activate(def.provider, def.model)
  }

  const run = (): void => {
    if (inFlight !== undefined) return
    inFlight = evaluate()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`llm fallback 评估失败: ${message}`)
        deps.journal('llm-fallback-error', message)
      })
      .finally(() => {
        inFlight = undefined
      })
  }

  // 首次评估延迟到启动收尾：lifeboat 首位加载时兄弟插件的 adapter 尚未注册，
  // 立刻评估会把"还没加载"误判为"缺席"。事件订阅覆盖后续变化。
  const bootTimer = setTimeout(run, 10_000)
  ctx.effect(() => () => clearTimeout(bootTimer), 'lifeboat: fallback boot timer')
  ctx.on('ready' as never, run)
  // 只响应与本判定相关的命名空间变化：journal 写自身命名空间，不过滤会自触发循环。
  const WATCHED_NS = new Set(['agent-default-model', 'llm-pi-ai', RAW_NS_LLM_PI])
  ctx.root.on('settings/updated' as never, (ns: unknown) => {
    if (typeof ns === 'string' && WATCHED_NS.has(ns)) run()
  })
  // 事件名已核对：0.1.2-alpha.2 的 dsh-llm 保留 'llm/adapters-updated'
  // （packages/llm/llm/src/types.ts:23 module augmentation，index.ts:344 于每次
  // adapter 注册/注销提交点 dispatch）；@deepseek-ai/dsh-llm 的类型导入已携带该
  // 声明，无需 as never。
  ctx.root.on('llm/adapters-updated', run)
}
