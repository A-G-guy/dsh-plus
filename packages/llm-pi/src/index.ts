/**
 * dsh 插件：自定义 LLM 路由（方案 4 基准层）。
 *
 * 复用官方 PiAiAdapter（消息互译/护栏零重写），经官方承认的 profiles 回调
 * 接缝注入插件自建的 provider 物化产物，从而获得：
 * - 全量 compat（逐协议字段表，写入即校验，对比官方的 2 字段+静默丢弃）；
 * - 模型继承（内置目录 → models.dev 快照 → 手写，用户显式字段最终覆盖）；
 * - 模块解析优先 dsh 安装树（dsh 升级即自动跟随上游），vendored 副本兜底。
 *
 * 注册全新的 route 名，不触碰官方 llm-pi-ai 的任何 route 与配置。
 *
 * 接线约束：inject 须含 credentials（auth-inline/deepseek-routes 经
 * ctx.get('credentials') 读 seam；凭据解析为请求时惰性调用，硬声明保证
 * 时序，消除启动早窗口的一次性 MISSING_CREDENTIAL）。
 * @module @dsh-plus/llm-pi
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type LlmPiConfig } from './config.ts'
import { registerCatalogApi } from './config-api.ts'
import { startRuntime } from './service.ts'

export const name = 'dsh-plus-llm-pi'

export const inject = ['credentials', 'llm'] as const

export type {
  LlmPiConfig,
  ModelEntryConfig,
  ProviderProfileConfig,
} from './config.ts'
export { SETTINGS_NS } from './config.ts'
export { Config }

export async function apply(ctx: Context, config: LlmPiConfig): Promise<void> {
  const runtime = await startRuntime(ctx, config)
  ctx.inject(['webServer'], (webCtx) => {
    registerCatalogApi(webCtx, runtime)
  })
}
