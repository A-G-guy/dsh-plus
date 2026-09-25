/**
 * 浏览器半：Service Worker 的注册与注销（load 后执行，不与首屏抢带宽）。
 *
 * 启动链路：plugin apply → window load（已过则下一个宏任务）→
 * decideClientAction 裁决：
 * - register：幂等注册 `/dsh-plus/shell-sw.js`（scope `/`，由 node 半路由的
 *   Service-Worker-Allowed 头授权）；新 SW 不 skipWaiting，本页不受影响，
 *   从下一次导航开始接管。
 * - cleanup（settings 禁用）：注销 scriptURL 匹配的注册 + 删除本插件
 *   前缀的全部缓存——一键恢复原生网络行为。
 * - skip：无配置行（插件缺席）或非安全上下文/无 SW 支持（裸 http 局域网
 *   直连）——零行为，其余插件不受影响。
 *
 * 所有异步失败仅带上下文 warn/debug，绝不抛入 boot 链路。ctx.effect 兜底
 * 移除 load 监听与未触发的定时器（已注册的 SW 不随 HMR 注销——它是部署级
 * 状态，不是会话级状态）。
 * 构建产物须为 window.__ModuleLoader__.load({id, factory}) 形式
 * （包装见 tsdown.config.ts 的 banner/footer）。
 * @module @dsh-plus/web-shell-sw/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { decideClientAction } from './decision.ts'
import { SW_CACHE_PREFIX, SW_GLOBAL_KEY, SW_SCRIPT_PATH } from './ns.ts'

export const name = 'dsh-plus-web-shell-sw'

/** 注入的配置行形状（node 半保证 JSON 可序列化）。 */
interface SwGlobal {
  readonly enabled?: boolean
}

/** 收窄注入的 globalThis 值（形状不符一律视为缺席）。 */
function readConfig(): SwGlobal | undefined {
  const value: unknown = Reflect.get(globalThis, SW_GLOBAL_KEY)
  if (typeof value !== 'object' || value === null) return undefined
  return value as SwGlobal
}

/** 注册（幂等；失败仅告警——SW 缺席不影响页面任何功能）。 */
function registerSw(): void {
  navigator.serviceWorker.register(SW_SCRIPT_PATH, { scope: '/' }).then(
    () => console.debug('[web-shell-sw] SW registered'),
    (error: unknown) => console.warn('[web-shell-sw] SW 注册失败（页面功能不受影响）', error),
  )
}

/** 该注册是否属于本插件（三态 worker 任一匹配即可；scriptURL 在 worker 上）。 */
function isOurRegistration(registration: ServiceWorkerRegistration): boolean {
  return [registration.active, registration.waiting, registration.installing].some(
    (worker) => worker?.scriptURL.endsWith(SW_SCRIPT_PATH) === true,
  )
}

/** 禁用清理：注销本插件的 SW 注册 + 删除本插件前缀的全部缓存。 */
function cleanupSw(): void {
  const run = async (): Promise<void> => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const registration of registrations) {
        if (isOurRegistration(registration)) await registration.unregister()
      }
      const keys = await caches.keys()
      for (const key of keys) {
        if (key.startsWith(SW_CACHE_PREFIX)) await caches.delete(key)
      }
      console.info('[web-shell-sw] 已注销 SW 并清理缓存（恢复原生网络行为）')
    } catch (error) {
      console.warn('[web-shell-sw] 禁用清理失败（下次加载会重试）', error)
    }
  }
  void run()
}

export function apply(ctx: Context): void {
  const config = readConfig()
  const action = decideClientAction(config, {
    isSecureContext: window.isSecureContext,
    hasServiceWorker: 'serviceWorker' in navigator,
  })
  if (action === 'skip') return

  const run = (): void => {
    if (action === 'register') registerSw()
    else cleanupSw()
  }

  // load 后下一个宏任务执行：此时首屏资源已全部就绪，注册/注销零竞争。
  let timer: number | undefined
  let disposed = false
  const start = (): void => {
    if (disposed) return
    timer = window.setTimeout(run, 0)
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })

  ctx.effect(
    () => () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('load', start)
    },
    'web-shell-sw: cancel pending register/cleanup',
  )
}
