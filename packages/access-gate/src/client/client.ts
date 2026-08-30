/**
 * 浏览器半入口：注册 locale 字典 + 向 settings.plugin.item 插槽注册「访问控制」卡片。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 *
 * 类型说明：浏览器半只用到 slots/locale/remote 的很窄一面，
 * scope 与基础控件走 @dsh-plus/shared/client 套件（收编自本插件原实现）。
 * 该插槽为 keyed 槽位：key 必须是卡片编辑的 settings 命名空间
 * （即服务端 settingsNamespace() 注册的同一字面量，见 ../ns.ts），
 * 官方配置页按此 key 与 Host 已注册命名空间配对分发。
 * 配置读写经 ctx.remote.settings 直连（0.1.2-alpha.1 起 connection.api.settings
 * 已移除；不复用 settingsScope 服务——非 loopback 页面下它固定 memory 模式无数据）。
 * @module @dsh-plus/access-gate/client
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  createNamespaceApi,
  createSettingsScope,
  type SettingsRemoteFace,
} from '@dsh-plus/shared/client'
import { SETTINGS_NS } from '../ns.ts'
import { AccessGateCard } from './card.tsx'
import { en, NS, zh } from './i18n.ts'
import { injectStyle } from './styles.ts'

export const name = 'dsh-plus-access-gate'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings'] as const

interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

interface RemoteLike {
  settings: SettingsRemoteFace
  $on(event: string, listener: (payload?: unknown) => void): () => void
}

interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
  get(key: 'remote'): RemoteLike
  on(event: string, listener: () => void): () => void
  effect(execute: () => () => void, label?: string): unknown
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const tag = injectStyle()
  c.effect(
    () => () => {
      tag?.remove()
    },
    'access-gate: style',
  )
  c.effect(() => c.locale.register(NS, { zh, en }), 'access-gate: locale')
  const scope = createSettingsScope(c, SETTINGS_NS, 'access-gate: settings scope')
  const api = createNamespaceApi(c.get('remote').settings, SETTINGS_NS)
  c.slots.inject('settings.plugin.item', () =>
    c.slots.register(
      {
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        locale: NS,
        inject: () => ({ t: c.locale.bind(NS), scope, api }),
      },
      AccessGateCard,
    ),
  )
}
