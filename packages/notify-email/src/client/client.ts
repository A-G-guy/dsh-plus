/**
 * 浏览器半入口：注册 locale 字典 + 注册「邮件通知」卡片
 * （injectPluginConfigCard 三槽位：legacy settings.plugin.item 与 0.1.6-alpha.2
 * 独立插件页的 plugins.row.config / plugins.bundle.config）。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 *
 * 类型说明：浏览器半只用到 slots/locale/remote 的很窄一面，
 * scope 与基础控件走 @dsh-plus/shared/client 套件（收编自本插件原实现）。
 * 配置读写经 ctx.remote.settings 直连（0.1.2-alpha.1 起 connection.api.settings
 * 已移除；0.1.7 起 settingsScope 服务亦删除（configForms 取代）——插件卡片自始
 * 直连 remote.settings）；自定义端点仅剩「发送测试邮件」（api.ts）。
 * 卡片 key/rowId 约定见 @dsh-plus/shared/client/config-slots。
 * @module @dsh-plus/notify-email/client
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  cardCss,
  createNamespaceApi,
  createSettingsScope,
  injectCardStyle,
  injectPluginConfigCard,
  type PluginClientContext,
} from '@dsh-plus/shared/client'
import { SETTINGS_NS } from '../ns.ts'
import { NotifyEmailCard } from './card.tsx'
import { type DictKey, en, NS, zh } from './i18n.ts'

export const name = 'dsh-plus-notify-email'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings'] as const

/** 宿主窄面收编在 @dsh-plus/shared/client；TKey 传入本包 DictKey 使键名受检。 */
type ClientContext = PluginClientContext<DictKey>

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
  const scope = createSettingsScope(c, SETTINGS_NS, 'notify-email: settings scope')
  const api = createNamespaceApi(c.get('remote').settings, SETTINGS_NS)
  injectPluginConfigCard(c.slots, {
    ns: SETTINGS_NS,
    rowId: 'dsh-plus-notify-email',
    pkg: '@dsh-plus/notify-email',
    component: NotifyEmailCard,
    inject: () => ({ t: c.locale.bind(NS), scope, api }),
  })
}
