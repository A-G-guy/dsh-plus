/**
 * 浏览器半入口：注册 locale 字典 + 向 settings.general.item 插槽注册「重新加载」行。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 *
 * 类型说明：浏览器半只用到 slots/locale 的很窄一面，以最小本地接口声明，
 * 避免为构建期类型引入整条官方 client 依赖树；运行时契约以官方
 * dsh-client-ui-settings 的 settings.general.item 插槽（ui-theme 同款）为准。
 * @module @dsh-plus/reload/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { fetchHealth } from './api.ts'
import { en, NS, zh } from './i18n.ts'
import { ReloadRow } from './row.tsx'
import { injectStyle } from './styles.ts'
import { startRestartWatchdog } from './watchdog.ts'

export const name = 'dsh-plus-reload'

/** health 未下发间隔（旧版 host）时的兜底轮询间隔；权威值是 host 配置 watchdogIntervalSeconds。 */
const WATCHDOG_FALLBACK_INTERVAL_MS = 30_000

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale'] as const

interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
  effect(execute: () => () => void, label?: string): unknown
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const tag = injectStyle()
  c.effect(
    () => () => {
      tag?.remove()
    },
    'reload: style',
  )
  c.effect(() => c.locale.register(NS, { zh, en }), 'reload: locale')

  // 被动重启检测：bootId 基线 + 低频轮询 + 可见性恢复即查；覆盖任何来源的重启。
  c.effect(() => {
    const watchdog = startRestartWatchdog({
      fetchHealth,
      reload: () => location.reload(),
      fallbackIntervalMs: WATCHDOG_FALLBACK_INTERVAL_MS,
      setIntervalFn: (fn, ms) => setInterval(fn, ms),
      clearIntervalFn: (handle) => clearInterval(handle as number),
    })
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void watchdog.checkNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      watchdog.stop()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, 'reload: restart watchdog')

  c.slots.inject('settings.general.item', () =>
    c.slots.register(
      {
        name: 'settings.general.item',
        id: 'dsh-plus-reload',
        order: 90,
        locale: NS,
        inject: () => ({ t: c.locale.bind(NS) }),
      },
      ReloadRow,
    ),
  )
}
