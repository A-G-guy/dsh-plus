/**
 * dsh 插件：外壳 Service Worker（web-shell-sw）。
 *
 * 问题：弱网/远程访问下每次冷启动都要重新拉 ~1.4MB 外壳 + ~4MB 插件组合包
 * （HTTP 缓存头已由 web-cache-headers 与官方 immutable 覆盖，但浏览器缓存
 * 可被淘汰、且 index 本身不可缓存）；断网时完全打不开。Service Worker 提供
 * 一层由本插件完全掌控的 Cache Storage：内容寻址资源 cache-first、index
 * network-first 离线兜底。
 *
 * 三半协作，均为纯增量：
 * - node 半：每次渲染 index 推 `kind:'global'` 配置行（含 enabled=false——
 *   浏览器半据此注销，禁用即恢复原生行为）；精确路由 GET/HEAD
 *   `/dsh-plus/shell-sw.js` 服务生成的 SW 脚本（Service-Worker-Allowed: /
 *   使 scope 覆盖全站）。
 * - 浏览器半（src/client.ts）：load 后经 requestIdleCallback 注册（不与
 *   首屏抢带宽）；禁用时注销 SW 并清空本插件缓存。
 * - SW 脚本（src/sw-script.ts 生成）：见该模块注释——不 skipWaiting、
 *   不碰 RPC/SSE/token、no-store 永不入库。
 *
 * 安全边界与已知约束：
 * - 仅安全上下文（https / localhost）可用 Service Worker；裸 http 的
 *   局域网直连降级为「无 SW」，其余插件不受影响。
 * - access-gate 未豁免 sw.js：注册发生在已认证页面（cookie 随请求携带），
 *   未认证时浏览器更新检查得 403 → 保留现有 SW，不影响围栏语义。
 * - 插件整体卸载会留下孤儿 SW：docs 给出一行手动清理命令。
 * @module @dsh-plus/web-shell-sw
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { unwrapVolatile } from '@dsh-plus/shared'

import type { WebShellSwConfig, WebShellSwConfigFields } from './config.ts'
import { SW_GLOBAL_KEY, SW_SCRIPT_PATH } from './ns.ts'
import { serveServiceWorker } from './route.ts'

export const name = 'dsh-plus-web-shell-sw'

/** 无硬 inject：headless 等无 webServer 的 profile 里本插件空转（见 boot-retry 同款说明）。 */

export { Config } from './config.ts'
export { SETTINGS_NS } from './ns.ts'
export type { WebShellSwConfig }

/**
 * 装配路由与配置注入。配置行恒推（含 enabled=false——禁用需要浏览器半
 * 执行注销，「行缺席」会使其无法区分禁用与未安装）；路由恒注册（禁用时
 * 无人注册新 SW，已注册的由配置行驱动注销，无需路由参与）。
 * @param ctx - 宿主上下文（webServer 可选）。
 * @param config - 活动字段形态的行级 config（测试可传平面值）。
 */
export function apply(ctx: Context, config: WebShellSwConfig | WebShellSwConfigFields): void {
  const logger = ctx.logger('web-shell-sw')
  // 活动引用原位提交：每次渲染现取快照，settings 翻转对下一次页面加载生效。
  const current = (): WebShellSwConfig => unwrapVolatile(config)

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.on('webserver/index-inject', (table) => {
          table.push({
            kind: 'global',
            name: SW_GLOBAL_KEY,
            value: { enabled: current().enabled },
          })
        }),
      'web-shell-sw: index injection',
    )
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: SW_SCRIPT_PATH,
          handler: serveServiceWorker,
        }),
      'web-shell-sw: sw.js route',
    )
    logger.info(`installed (script route ${SW_SCRIPT_PATH})`)
  })
}

/** 供测试断言 inject 形态：本插件不声明硬依赖。 */
export const inject = [] as const
