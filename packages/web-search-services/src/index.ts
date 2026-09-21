/**
 * dsh-plus 插件：web_search 免费后端聚合（search-services skill 桥接）。
 *
 * 经官方 ctx.web provider 扩展点注册 id=search-services 的搜索后端：web_search /
 * web_fetch 工具、渲染层与提示词零修改，模型可见输出格式与官方 provider 逐字节
 * 一致。优先级与自动回退由 skill 的 search.py 编排（含 Tavily 多 key 轮转）；
 * Context7 仅支持带库名的 docs 查询，web_search 契约无 library 概念，不进搜索链。
 * @module @dsh-plus/web-search-services
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'

import { Config, SETTINGS_NS, type WebSearchServicesConfig } from './config.ts'
import { SearchServicesProvider } from './provider.ts'

export const name = 'dsh-plus-web-search-services'

/** 行级 inject：dsh-web 服务激活后才应用本行（provider 注册即需 ctx.web）。 */
export const inject = ['web'] as const

export { PROVIDER_ID, SearchServicesProvider } from './provider.ts'
export { Config, SETTINGS_NS }

export function apply(ctx: Context, config: WebSearchServicesConfig): void {
  const provider = new SearchServicesProvider(configSource(ctx, config))
  ctx.effect(
    () => ctx.web.registerSearchProvider(provider),
    'dsh-plus-web-search-services: register search provider',
  )
}

/**
 * 配置源：settings 用户层（$DSH_HOME/settings.yaml，热生效）在时优先生效，
 * 缺席/detach 回落 cordis 行级 config（官方 installSection 可选消费范式）。
 */
function configSource(
  ctx: Context,
  rowConfig: WebSearchServicesConfig,
): () => WebSearchServicesConfig {
  let current: () => WebSearchServicesConfig = () => rowConfig
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, rowConfig, {
      setSource: (source) => {
        current = source
      },
      onChange: () => {},
    })
  })
  return () => current()
}
