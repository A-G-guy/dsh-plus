/**
 * dsh 插件：弱网首屏计时观测（web-boot-timing）。
 *
 * 问题：tailnet/弱网下「打开 Web UI → 可输入操作」动辄几十秒，但哪一段
 * （TTFB / 外壳下载 / 插件组合包 / 遮罩移除 / 首次输入）在吃时间没有量化
 * 手段，优化只能猜。
 *
 * 本插件做两件事，均为纯增量：
 * - node 半：每次渲染 index 时经 `webserver/index-inject` 推一行
 *   `kind:'global'` 配置（enabled/settleMs）；enabled=false 不推，
 *   浏览器半见不到配置行即零行为（结构守卫：webServer 缺席 = 插件缺席）。
 * - 浏览器半（src/client.ts）：读 Performance API 五相时钟 + 资源分桶，
 *   window load + settleMs 后出一份报告——控制台、`globalThis` 钩子、
 *   localStorage 历史（最近 10 次，供优化前后对比）。
 *
 * 明确不做（零行为改动承诺）：
 * - 不改写任何请求/响应、不注册路由、不碰 RPC/SSE/插件加载器；
 * - 不注入任何 DOM（报告只进 console/storage，UI 表现完全不受影响）；
 * - 报告采集异常一律隔离在 try/catch 内，绝不拖垮 boot。
 * @module @dsh-plus/web-boot-timing
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { unwrapVolatile } from '@dsh-plus/shared'

import type { WebBootTimingConfig, WebBootTimingConfigFields } from './config.ts'
import { TIMING_GLOBAL_KEY } from './ns.ts'

export const name = 'dsh-plus-web-boot-timing'

/** 无硬 inject：headless 等无 webServer 的 profile 里本插件空转（见 boot-retry 同款说明）。 */

export { Config } from './config.ts'
export { SETTINGS_NS } from './ns.ts'
export type { WebBootTimingConfig }

/**
 * 注册 index 注入行：每次渲染 index.html 时把浏览器半配置推进注入表。
 * 行只在 enabled=true 时出现——禁用即「配置行缺席」，浏览器半零行为，
 * 无需与浏览器通信撤销任何东西（本插件本就没有持久状态）。
 * @param ctx - 宿主上下文（webServer 可选）。
 * @param config - 活动字段形态的行级 config（测试可传平面值）。
 */
export function apply(ctx: Context, config: WebBootTimingConfig | WebBootTimingConfigFields): void {
  const logger = ctx.logger('web-boot-timing')
  // 活动引用原位提交：每次渲染现取快照，settings 翻转对下一次页面加载生效。
  const current = (): WebBootTimingConfig => unwrapVolatile(config)

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.on('webserver/index-inject', (table) => {
          const cfg = current()
          if (cfg.enabled !== true) return
          table.push({
            kind: 'global',
            name: TIMING_GLOBAL_KEY,
            value: { enabled: true, settleMs: cfg.settleMs },
          })
        }),
      'web-boot-timing: index injection',
    )
    logger.info('installed (index injection; report lands in console + localStorage)')
  })
}

/** 供测试断言 inject 形态：本插件不声明硬依赖。 */
export const inject = [] as const
