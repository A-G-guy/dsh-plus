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
import { unwrapVolatile } from '@dsh-plus/shared'

import type { WebCacheHeadersConfig, WebCacheHeadersConfigFields } from './config.ts'
import { installImmutableAssetsPatch, uninstallImmutableAssetsPatch } from './patch.ts'

export const name = 'dsh-plus-web-cache-headers'

/** 无硬 inject：见模块头「结构守卫」。 */

export { Config } from './config.ts'
export { SETTINGS_NS } from './ns.ts'
export type { WebCacheHeadersConfig }

/**
 * 装配补丁并接线配置源：0.1.7 起配置为 loader 解析的 volatile 活动字段
 * （用户层 override 并入行级 config，写入原位提交），enabled 翻转即时装/卸
 * 补丁，无需 /reload；插件 dispose（profile 卸载 / live reload）保证卸下。
 * @param ctx - 宿主上下文。
 * @param config - 活动字段形态的行级 config（测试可传平面值）。
 */
export function apply(
  ctx: Context,
  config: WebCacheHeadersConfig | WebCacheHeadersConfigFields,
): void {
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

  // 活动引用原位提交（替代 0.1.6 setSource/onChange）：每次读现取平面快照，
  // volatile 提交事件驱动 enabled 翻转装卸。
  const current = (): WebCacheHeadersConfig => unwrapVolatile(config)
  ctx.events.on('loader/volatile-update', () => sync(current().enabled))

  sync(current().enabled)
  ctx.effect(() => () => sync(false), 'web-cache-headers: dispose 卸下补丁')
}
