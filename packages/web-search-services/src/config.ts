/**
 * 配置单一事实源：cordis 行级 Config（组合默认值，patch 层可覆盖）与 settings
 * namespace（用户层 $DSH_HOME/settings.yaml，热生效）共用同一 schemastery schema。
 *
 * 密钥主来源是 search-services skill 的 env 文件（envFile，默认
 * ~/.config/search-services/env），保持 skill 单事实源、零搬迁。行级 keys 仅为
 * 覆盖逃生舱；按存储规范 role('secret') 字段只允许行级注入，settings 用户层勿填。
 * @module web-search-services/config
 */
import z from '@deepseek-ai/schemastery'
import type { UnwrapVolatile } from '@dsh-plus/shared'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

export const SETTINGS_NS = NS_LITERAL

/** 空串表示使用随包内置脚本（本包 scripts/search.py，见 scripts/README.md）。 */
export const DEFAULT_SCRIPT_PATH = ''
export const DEFAULT_ENV_FILE = '~/.config/search-services/env'
export const DEFAULT_TIMEOUT_MS = 55_000
export const DEFAULT_PRIORITY: readonly SearchBackend[] = ['tavily', 'exa', 'openai-chat']

export type SearchBackend = 'tavily' | 'exa' | 'openai-chat'

const PRIORITY_ENTRY = z.union(['tavily', 'exa', 'openai-chat'])

const KeysSchema = z.object({
  tavily: z
    .string()
    .role('secret')
    .description('Tavily API key（覆盖 envFile 的 TAVILY_API_KEY；行级注入专用）')
    .default(''),
  exa: z
    .string()
    .role('secret')
    .description('Exa API key（覆盖 envFile 的 EXA_API_KEY；行级注入专用）')
    .default(''),
  openaiApiKey: z
    .string()
    .role('secret')
    .description('OpenAI-compatible API key（覆盖 SEARCH_OPENAI_API_KEY；行级注入专用）')
    .default(''),
  openaiBaseUrl: z
    .string()
    .description('OpenAI-compatible base URL（覆盖 SEARCH_OPENAI_BASE_URL）')
    .default(''),
  openaiModel: z
    .string()
    .description('OpenAI-compatible 搜索模型名（覆盖 SEARCH_OPENAI_MODEL）')
    .default(''),
})

// 0.1.7：全字段 `.volatile()`——条目进入 settings describe 视图（卡片可读写；
// keys 内 role('secret') 字段由 describe/write 层做密文遮蔽，用户层勿填），
// loader 原位提交活动引用，current() 现取即热。
export const Config = z.object({
  scriptPath: z
    .string()
    .description('search.py 路径（支持 ~ 展开）；空串 = 使用随包内置脚本副本')
    .default(DEFAULT_SCRIPT_PATH)
    .volatile(),
  envFile: z
    .string()
    .description('skill 密钥 env 文件路径（支持 ~ 展开）；空串表示不读 envFile')
    .default(DEFAULT_ENV_FILE)
    .volatile(),
  python: z.string().description('python 可执行文件').default('python3').volatile(),
  priority: z
    .array(PRIORITY_ENTRY)
    .description('后端优先级：靠前的先尝试，失败自动回退到下一个')
    .default([...DEFAULT_PRIORITY])
    .volatile(),
  timeoutMs: z
    .natural()
    .min(1000)
    .description('单次搜索子进程超时（毫秒），应低于 dsh-tool-web 的 searchTimeoutMs')
    .default(DEFAULT_TIMEOUT_MS)
    .volatile(),
  keys: KeysSchema.default({
    tavily: '',
    exa: '',
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
  }).volatile(),
})

/** 活动字段形态（0.1.7 loader 解析产物：volatile 字段为活动引用）。 */
export type WebSearchServicesConfigFields = Schemastery.TypeT<typeof Config>
/** 平面配置形态（消费面的读取形态，由活动引用解包得到）。 */
export type WebSearchServicesConfig = UnwrapVolatile<WebSearchServicesConfigFields>
export type KeysConfig = WebSearchServicesConfig['keys']
