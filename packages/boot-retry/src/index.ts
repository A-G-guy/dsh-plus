/**
 * dsh 插件：弱网引导重试（boot-retry）。
 *
 * 问题：官方 `dsh-client-web` 默认的 bundle 加载器（`defaultLoadBundle`）
 * 对每个插件包只尝试一次——一个 `<script>` 元素，`error` 事件直接 reject。
 * 该 reject 使 `arriveGraphRow` 抛错，`assertEntriesActive` 在 boot 结束时
 * 汇总为 "web boot: N entries did not activate"，页面停在 "Failed to load
 * plugins"。弱网（例如 tailnet 走 DERP 中继时）一次 TCP 抖动即命中此路径，
 * 而浏览器对 `<script>` 失败自身不会重试。
 *
 * 本插件只做一件事：经官方已预留的 `globalThis.__DSH_TRANSPORT__.loadBundle`
 * 缝注入一个「原 URL 重试」的加载器（见 boot-script.ts 的时序与语义说明）。
 *
 * 明确不做：
 * - 不缓存任何响应体（不读 body、不落 Cache Storage、不存内存表）；
 * - 不改写 URL / rev，不解释插件包格式；
 * - 不触碰 `/api`（RPC）与 `/plugins/events`（SSE）。
 * 因此 HMR 的 `invalidate → prefetch(新 rev)` 语义完全不受影响：rev 变化即
 * URL 变化，必然请求新字节；同 URL 请求也始终直达服务端。
 *
 * 结构守卫（fail-safe）：若宿主未提供 `webserver` 服务，插件直接空转，
 * 不注入任何脚本——等价于插件缺席，绝不使 boot 失败。
 * @module @dsh-plus/boot-retry
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import { bootRetryScript } from './boot-script.ts'
import { type BootRetryConfig, Config } from './config.ts'

export const name = 'dsh-plus-boot-retry'

/** 无硬 inject：见下方 apply 的惰性 inject 说明。 */

export type { BootRetryConfig }
export { Config }

/**
 * 注册 index 注入行：每次渲染 index.html 时把引导脚本推进注入表。
 *
 * 该行是 inline script，不含 `</script`；内容只依赖本插件的 config，
 * 与渲染时刻的会话状态无关。
 *
 * 惰性 inject（而非模块级 `inject = ['webServer']`）：headless 等无
 * `webServer` 的 profile 里，硬 inject 会让本行永久 pending，使
 * `assertEntriesActivated` 判定「1 entry did not activate」而导致整个 boot
 * 失败（smoke-prod 实测捕获）。改为 `ctx.inject([...])` 后，服务缺席时本行
 * 照常 active、只是不注册任何东西（等价插件缺席），绝不拖垮同 profile
 * 的其它插件。
 * @param ctx - 宿主上下文（webServer 可选）。
 * @param config - 已验证的插件配置。
 */
export function apply(ctx: Context, config: BootRetryConfig): void {
  if (config.enabled !== true) return
  const logger = ctx.logger('boot-retry')

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.on('webserver/index-inject', (table) => {
          table.push({
            kind: 'script',
            placement: 'head',
            text: bootRetryScript({
              maxAttempts: config.maxAttempts,
              backoffMs: config.backoffMs,
              retryShellScript: config.retryShellScript,
              shellMaxAttempts: config.shellMaxAttempts,
            }),
          })
        }),
      'boot-retry: index injection',
    )

    logger.info(
      `installed (maxAttempts=${String(config.maxAttempts)}, shell=${String(config.retryShellScript)})`,
    )
  })
}

/** 供测试断言 inject 形态：本插件不声明硬依赖。 */
export const inject = [] as const
