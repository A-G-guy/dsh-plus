/**
 * 浏览器半入口：注册 locale 字典 + 注册「Actual Budget 连接」卡片
 * （injectPluginConfigCard 两槽位：插件页 plugins.row.config /
 * plugins.bundle.config）。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 * 配置读写经 ctx.remote.settings 直连（scope/api 来自 @dsh-plus/shared/client）。
 * @module @dsh-plus/actual/client
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  createNamespaceApi,
  createSettingsScope,
  injectPluginConfigCard,
  type PluginClientContext,
} from '@dsh-plus/shared/client'

import { SETTINGS_NS } from '../ns.ts'
import { ActualCard } from './card.tsx'
import { type DictKey, en, NS, zh } from './i18n.ts'
import { injectStyle } from './styles.ts'

export const name = 'dsh-plus-actual'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings'] as const

/** 宿主窄面收编在 @dsh-plus/shared/client；TKey 传入本包 DictKey 使键名受检。 */
type ClientContext = PluginClientContext<DictKey>

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const tag = injectStyle()
  c.effect(
    () => () => {
      tag?.remove()
    },
    'actual: style',
  )
  c.effect(() => c.locale.register(NS, { zh, en }), 'actual: locale')
  const scope = createSettingsScope(c, SETTINGS_NS, 'actual: settings scope')
  const api = createNamespaceApi(c.get('remote').settings, SETTINGS_NS)
  injectPluginConfigCard(c.slots, {
    ns: SETTINGS_NS,
    rowId: 'dsh-plus-actual',
    pkg: '@dsh-plus/actual',
    component: ActualCard,
    inject: () => ({ t: c.locale.bind(NS), scope, api }),
  })
}
