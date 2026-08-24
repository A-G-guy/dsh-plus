/**
 * 浏览器半入口：注册 locale 字典 + 向 settings.plugin.item 插槽注册「邮件通知」卡片。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 *
 * 类型说明：浏览器半只用到 slots/locale/connection/remote 的很窄一面，
 * scope 与基础控件走 @dsh-plus/shared/client 套件（收编自本插件原实现）。
 * rc7 起该插槽为 keyed 槽位：key 必须是卡片编辑的 settings 命名空间
 * （即服务端 settingsNamespace() 注册的同一字面量，见 ../ns.ts），
 * 官方配置页按此 key 与 Host 已注册命名空间配对分发。
 * 配置读写经官方 settings RPC 直连（rc7 起第三方命名空间全量开放；
 * 不复用 settingsScope 服务——非 loopback 页面下它无数据）；
 * 自定义端点仅剩「发送测试邮件」（api.ts）。
 * @module @dsh-plus/notify-email/client
 */
import type { Context } from '@deepseek-ai/cordis'
import { cardCss, createApiScope, injectCardStyle } from '@dsh-plus/shared/client'
import { SETTINGS_NS } from '../ns.ts'
import { NotifyEmailCard } from './card.tsx'
import { en, NS, zh } from './i18n.ts'

export const name = 'dsh-plus-notify-email'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale', 'connection', 'remote'] as const

interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

interface RemoteLike {
  $on(event: string, listener: (payload?: unknown) => void): () => void
}

interface ConnectionLike {
  api: { settings: Parameters<typeof createApiScope>[0] }
}

interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
  get(key: 'connection'): ConnectionLike
  get(key: 'remote'): RemoteLike
  on(event: string, listener: () => void): () => void
  effect(execute: () => () => void, label?: string): unknown
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const tag = injectCardStyle('@dsh-plus/notify-email', cardCss('dne'))
  c.effect(
    () => () => {
      tag?.remove()
    },
    'notify-email: style',
  )
  c.effect(() => c.locale.register(NS, { zh, en }), 'notify-email: locale')
  const api = c.get('connection').api.settings
  const scope = createApiScope(api, SETTINGS_NS, c, 'notify-email: settings scope')
  c.slots.inject('settings.plugin.item', () =>
    c.slots.register(
      {
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        locale: NS,
        inject: () => ({ t: c.locale.bind(NS), scope, api }),
      },
      NotifyEmailCard,
    ),
  )
}
