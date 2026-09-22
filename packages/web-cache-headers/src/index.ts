/**
 * dsh 插件：GUI 静态资源长缓存（web-cache-headers）。
 *
 * 问题：dsh 前端 dist（`dsh-host-frontend-static` 经 fallback 服务）的响应只有
 * content-type，无 Cache-Control/ETag——浏览器每次刷新都全量重下 ~1.4MB
 * （gzip 后约 500KB）JS/CSS。而 dist 文件全部内容哈希命名，本可安全 immutable。
 * `/plugins/*` 官方已自带 immutable 缓存头（dsh-client-modules），不在范围。
 *
 * 本插件只做一件事：进程级拦截 ServerResponse.writeHead，对内容寻址的
 * `/assets/*` 200 响应补 `Cache-Control: public, max-age=31536000, immutable`。
 * 纯增量、已有缓存头优先——dsh 升级自带策略时自动共存；唯一的关闭路径是
 * settings 的 enabled=false（热生效），立刻恢复 dsh 原生行为。
 *
 * 明确不做：
 * - 不注册任何路由（避免与 core 未来路由撞车）；
 * - 不缓存 index.html / favicon / manifest（保持每次最新，插件 rev 清单不走缓存）；
 * - 不触碰 `/plugins`（官方已 immutable）与任何插件 API 路由；
 * - development 环境自动禁用，保护 dev/HMR 的 same-URL 热更新语义。
 *
 * 结构守卫（fail-safe）：inject 为空，不依赖任何 dsh 服务；宿主形态任何变更
 * 都不影响本插件，反之本插件异常也绝不拖垮 boot（加头逻辑被隔离在 try 中）。
 * @module @dsh-plus/web-cache-headers
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'

import { Config, type WebCacheHeadersConfig } from './config.ts'
import { SETTINGS_NS } from './ns.ts'
import { installImmutableAssetsPatch, uninstallImmutableAssetsPatch } from './patch.ts'

export const name = 'dsh-plus-web-cache-headers'

/** 无硬 inject：见模块头「结构守卫」。 */

export type { WebCacheHeadersConfig }
export { Config, SETTINGS_NS }

/**
 * 装配补丁并接线配置源：settings 用户层（$DSH_HOME/settings.yaml，热生效）
 * 优先，缺席/detach 回落 cordis 行级 config。enabled 翻转即时装/卸补丁，
 * 无需 /reload；插件 dispose（profile 卸载 / live reload）保证卸下。
 * @param ctx - 宿主上下文（settings 可选）。
 * @param config - 行级 config（settings 缺席时的默认值来源）。
 */
export function apply(ctx: Context, config: WebCacheHeadersConfig): void {
  const logger = ctx.logger('web-cache-headers')
  if (process.env.NODE_ENV === 'development') {
    logger.info('development 环境：自动禁用（保护 dev/HMR 同 URL 热更新）')
    return
  }

  let installed = false
  const sync = (enabled: boolean): void => {
    if (enabled === installed) return
    if (enabled) installImmutableAssetsPatch()
    else uninstallImmutableAssetsPatch()
    installed = enabled
    logger.info(
      enabled ? '已装配 /assets immutable 缓存头补丁' : '已卸下缓存头补丁（恢复 dsh 原生行为）',
    )
  }

  let current: () => WebCacheHeadersConfig = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        sync(current().enabled)
      },
    })
  })

  sync(current().enabled)
  ctx.effect(() => () => sync(false), 'web-cache-headers: dispose 卸下补丁')
}
