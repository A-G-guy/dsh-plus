/**
 * 配置单一事实源：cordis 行级 Config（组合默认值）与 settings namespace
 *（用户层，经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml）共用同一
 * schemastery schema。无密钥字段（apiKeyEnv 是凭据引用名而非密钥本身）。
 *
 * 与官方 llm-pi-ai 的差异：
 * - compat 是开放 dict，物化时按协议校验（见 compat.ts），写入即拒绝未知键；
 * - provider/model 均支持 extends 继承（见 inherit.ts）。
 * @module llm-pi/config
 */

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间；webui 配置卡片与插件运行期读取同一份（字面量见 ./ns.ts）。 */
export const SETTINGS_NS = settingsNamespace(NS_LITERAL)

/** 本插件可为手写 route 提供的协议实现（与官方 PROTOCOLS 表一致）。 */
export const PROTOCOL_IDS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const
export type ProtocolId = (typeof PROTOCOL_IDS)[number]

/** pi-ai 思考档位，升级序。 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const MODALITIES = ['text', 'image'] as const

/** 路由适配器种类：pi = PiAiAdapter（默认）；deepseek = 官方 DeepSeekAdapter（文件通道）。 */
export const ADAPTER_KINDS = ['pi', 'deepseek'] as const
export type AdapterKind = (typeof ADAPTER_KINDS)[number]

/** deepseek 路由的思考/推理档位（线协议枚举，对齐官方 llm-deepseek）。 */
export const DEEPSEEK_THINKING = ['enabled', 'disabled'] as const
export const DEEPSEEK_REASONING_EFFORTS = ['off', 'low', 'high', 'max'] as const
export const DEEPSEEK_IMAGE_DETAILS = ['auto', 'low'] as const

export const DEFAULT_CONTEXT_WINDOW = 262144
export const DEFAULT_MAX_TOKENS = 32768
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000
/** 单请求 base64 图片载荷上限（rc8 起官方 ResolvedPiAiProviderProfile 必需字段；
 *  缺省取官方默认 20MiB，旧配置无需改动即自动生效）。 */
export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
/** dsh-timeout 的定时器上限（与官方 MAX_TIMER_DELAY_MS 对齐）。 */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/** 键为可选档位，值为线协议拼写；仅 off 可留空（支持但不发送参数）。 */
const reasoningEfforts = z.dict(z.union([z.string(), z.const(null)]), z.union(THINKING_LEVELS))

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]
export type Modality = (typeof MODALITIES)[number]
export type ReasoningEfforts = Partial<Record<ThinkingLevel, string | null>>

/** 单个模型条目：id 必填，其余字段缺省即继承。 */
export interface ModelEntryConfig {
  id: string
  extends?: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: Modality[]
  reasoningEfforts?: false | ReasoningEfforts
  compat?: Record<string, unknown>
  /** 以下仅 adapter: deepseek 的 route 有效（官方 llm-deepseek 目录字段）。 */
  imagePixelBudget?: number
  imageMaxBytes?: number
  imageDetail?: 'auto' | 'low'
}

/** 单个 provider route 配置（providers 字典的值）。 */
export interface ProviderProfileConfig {
  adapter?: AdapterKind
  extends?: string
  displayName?: string
  api?: ProtocolId
  baseURL?: string
  apiKeyEnv?: string
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  defaultContextWindow?: number
  defaultMaxTokens?: number
  defaultInput?: Modality[]
  reasoning?: ThinkingLevel
  thinkingBudgets?: {
    minimal: number
    low: number
    medium: number
    high: number
  }
  cacheRetention?: 'none' | 'short' | 'long'
  transport?: 'sse' | 'websocket' | 'websocket-cached' | 'auto'
  timeoutMs?: number
  websocketConnectTimeoutMs?: number
  streamIdleTimeoutMs?: number
  maxRequestImageBytes?: number
  retryPolicy?: unknown
  models?: ModelEntryConfig[]
  /** 以下仅 adapter: deepseek 的 route 有效（透传官方 llm-deepseek 同名策略）。 */
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  maxRequestFilesBytes?: number
  maxInlineRequestImageBytes?: number
  maxImagesPerRequest?: number
  imageOffloadByteQuantum?: number
  inlineImageOffloadByteQuantum?: number
  imageOffloadCountQuantum?: number
  filesApiTimeoutMs?: number
  fileExpiresAfterSeconds?: number
  fileRefreshMarginSeconds?: number
}

/** 插件配置根。 */
export interface LlmPiConfig {
  enabled: boolean
  catalogUrl: string
  catalogRefreshHours: number
  catalogProxy: string
  providers: Record<string, ProviderProfileConfig>
}

const thinkingBudgets = z.object({
  minimal: z.number(),
  low: z.number(),
  medium: z.number(),
  high: z.number(),
})

/**
 * compat 开放字典：承载 pi-ai 的全量 compat 字段（按协议分型，
 * 字段集与值校验见 compat.ts，在 settings 写入与 profile 构建时执行）。
 * schema 层不收紧，是因为字段集取决于本条目的 api，schema 无法表达条件分型。
 */
const compatDict = z.dict(z.any())

const modelEntry = z.object({
  id: z.string().required().description('模型 id（发送给 provider 的标识）'),
  extends: z
    .string()
    .description(
      '继承源："provider/model" 或裸 model id（随 provider 级 extends 源）；缺省先查内置目录同名模型',
    ),
  name: z.string().description('选择器显示名；缺省继承内置目录名，再退化为 id'),
  contextWindow: z.number().step(1).min(1).description('上下文容量（覆盖继承值）'),
  maxTokens: z
    .number()
    .step(1)
    .min(1)
    .description('输出能力上限；显式配置同时成为无 cap 请求的默认 cap'),
  input: z
    .array(z.union(MODALITIES))
    .description('请求模态；缺省继承内置目录，再退化 route defaultInput'),
  reasoningEfforts: z
    .union([z.const(false), reasoningEfforts])
    .description('可选 reasoning 档位：false=非推理模型；dict=档位→线值映射；缺省继承内置目录能力'),
  compat: compatDict.description('模型级 compat（字段级合并，压过 route 级与继承值）'),
  imagePixelBudget: z
    .number()
    .step(1)
    .min(1)
    .description('（仅 adapter: deepseek）单张请求图片的总像素预算；缺省继承官方目录'),
  imageMaxBytes: z
    .number()
    .step(1)
    .min(1)
    .description('（仅 adapter: deepseek）单张请求图片的编码字节上限；缺省继承官方目录'),
  imageDetail: z
    .union(DEEPSEEK_IMAGE_DETAILS)
    .description('（仅 adapter: deepseek）图片细节档位；low 使用 512x512 像素预算'),
})

const providerProfile = z.object({
  adapter: z
    .union(ADAPTER_KINDS)
    .description(
      '路由适配器：pi=PiAiAdapter（默认，三协议）；deepseek=官方 DeepSeekAdapter（图片走 Files API 文件通道，失败自动降级 base64）',
    )
    .default('pi'),
  extends: z
    .string()
    .description(
      'provider 级继承：内置 provider id，提供 api/baseURL 默认值与模型 extends 的缺省查找源',
    ),
  displayName: z.string().description('选择器显示名；缺省为 route 键'),
  api: z
    .union(PROTOCOL_IDS)
    .description('线协议；缺省逐模型取继承值的 api，全部一致时作为 route 协议'),
  baseURL: z.string().description('端点；缺省继承 extends 源 provider 的端点'),
  apiKeyEnv: z.string().role('credential-ref').description('凭据引用名（凭据服务/环境变量）'),
  headers: z.dict(z.string()).description('provider 请求头（Harness 署名头保留名优先）'),
  compat: compatDict.description('route 级 compat 默认（逐模型按字段生效）'),
  defaultContextWindow: z
    .number()
    .step(1)
    .min(1)
    .description('模型与继承源都未标注时的上下文容量兜底'),
  defaultMaxTokens: z.number().step(1).min(1).description('模型与继承源都未标注时的输出能力兜底'),
  defaultInput: z
    .array(z.union(MODALITIES))
    .description('模型与继承源都未声明时的模态兜底（不可为空）')
    .default(['text']),
  reasoning: z.union(THINKING_LEVELS).description('provider 默认 reasoning 档位'),
  thinkingBudgets: thinkingBudgets.description('支持 token 预算的推理 provider 的档位预算'),
  cacheRetention: z.union(['none', 'short', 'long']).description('提示缓存保留偏好'),
  transport: z.union(['sse', 'websocket', 'websocket-cached', 'auto']).description('流式传输偏好'),
  timeoutMs: z.natural().description('HTTP/provider 超时毫秒'),
  websocketConnectTimeoutMs: z.natural().description('WebSocket 连接超时毫秒'),
  streamIdleTimeoutMs: z
    .number()
    .min(Number.MIN_VALUE)
    .max(MAX_TIMER_DELAY_MS)
    .description('单支流式读取的最大空闲间隔毫秒'),
  maxRequestImageBytes: z
    .natural()
    .description('单请求 base64 图片载荷上限字节；缺省 20MiB（rc8 起生效，旧配置免改）'),
  retryPolicy: z.any().description('provider 重试策略（dsh-llm RetryPolicy 形状，构建期校验）'),
  thinking: z
    .union(DEEPSEEK_THINKING)
    .description('（仅 adapter: deepseek）思考模式开关；缺省用提供商默认'),
  reasoningEffort: z
    .union(DEEPSEEK_REASONING_EFFORTS)
    .description('（仅 adapter: deepseek）推理档位；缺省为 high'),
  maxRequestFilesBytes: z
    .number()
    .step(1)
    .min(1)
    .description('（仅 adapter: deepseek）单请求文件引用图片累积上限字节；缺省 128MiB'),
  maxInlineRequestImageBytes: z
    .number()
    .step(1)
    .min(1)
    .description('（仅 adapter: deepseek）文件通道降级后 base64 图片载荷上限字节；缺省 20MiB'),
  maxImagesPerRequest: z
    .number()
    .step(1)
    .min(1)
    .description(
      '（仅 adapter: deepseek）单请求图片数量上限；缺省 600（调低时需同步调低 imageOffloadCountQuantum）',
    ),
  imageOffloadByteQuantum: z
    .number()
    .step(1)
    .min(1)
    .description(
      '（仅 adapter: deepseek）文件引用超限后的原始字节削减步长；缺省 64MiB，不可超过 maxRequestFilesBytes',
    ),
  inlineImageOffloadByteQuantum: z
    .number()
    .step(1)
    .min(1)
    .description(
      '（仅 adapter: deepseek）base64 降级超限后的削减步长；缺省 10MiB，不可超过 maxInlineRequestImageBytes',
    ),
  imageOffloadCountQuantum: z
    .number()
    .step(1)
    .min(1)
    .description(
      '（仅 adapter: deepseek）图片数量超限后的削减步长；缺省 20，不可超过 maxImagesPerRequest',
    ),
  filesApiTimeoutMs: z
    .number()
    .min(Number.MIN_VALUE)
    .max(MAX_TIMER_DELAY_MS)
    .description('（仅 adapter: deepseek）单次 Files API 图片解析超时毫秒；缺省 60s'),
  fileExpiresAfterSeconds: z
    .number()
    .step(1)
    .min(3600)
    .max(2592000)
    .description('（仅 adapter: deepseek）上传文件的远端存活秒数；缺省 7 天'),
  fileRefreshMarginSeconds: z
    .number()
    .step(1)
    .min(0)
    .description('（仅 adapter: deepseek）文件过期前提前重传的余量秒数；缺省 3600'),
  models: z
    .array(modelEntry)
    .description('本 route 的模型目录；缺省且 provider 有 extends 时继承该源全部模型'),
})

export const Config: z<LlmPiConfig> = z.object({
  enabled: z.boolean().description('总开关（关闭则不注册任何 route）').default(true),
  catalogUrl: z
    .string()
    .description('models.dev 目录数据端点')
    .default('https://models.dev/api.json'),
  catalogRefreshHours: z
    .number()
    .description('models.dev 自动拉取间隔小时数；0 = 不自动拉取（可手动拉取或读已有缓存）')
    .default(0),
  catalogProxy: z
    .string()
    .description('拉取 models.dev 目录时的 HTTP 代理地址（如 http://127.0.0.1:7890）；留空直连')
    .default(''),
  providers: z.dict(providerProfile).description('provider 路由表，键即 route 名').default({}),
})

/** 卡片提交的形状：完整配置对象（含 providers 全量），settings.replace 整段覆盖。 */
export type LlmPiPatch = LlmPiConfig
