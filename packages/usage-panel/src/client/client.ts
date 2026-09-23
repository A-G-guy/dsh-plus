/**
 * 浏览器半入口：
 * - settings.section 官方插槽注册「用量统计」独立设置页；
 * - 价目卡片经 injectPluginConfigCard 三槽位注册（legacy settings.plugin.item
 *   与 0.1.6-alpha.2 插件页 plugins.row.config / plugins.bundle.config）。
 * 配置读写经 ctx.remote.settings 直连（0.1.2-alpha.1 起 connection.api.settings
 * 已移除；0.1.7 起 settingsScope 服务亦删除——configForms 取代，自始直连）。
 * @module @dsh-plus/usage-panel/client
 */
import type { Context } from '@deepseek-ai/cordis'

import {
  createNamespaceApi,
  createSettingsScope,
  injectPluginConfigCard,
  type PluginClientContext,
} from '@dsh-plus/shared/client'
import { type DictKey, en, NS, zh } from './i18n.ts'
import { UsagePriceCard } from './price-card.tsx'
import { UsageSection } from './section.tsx'
import { injectCardStyles, injectSectionStyle } from './styles.ts'

export const name = 'dsh-plus-usage-panel'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings'] as const

/** 宿主窄面收编在 @dsh-plus/shared/client；TKey 传入本包 DictKey 使键名受检。 */
type ClientContext = PluginClientContext<DictKey>

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const sectionTag = injectSectionStyle()
  const cardTag = injectCardStyles()
  c.effect(
    () => () => {
      sectionTag?.remove()
      cardTag?.remove()
    },
    'usage-panel: style',
  )
  c.effect(() => c.locale.register(NS, { zh, en }), 'usage-panel: locale')

  const t = c.locale.bind(NS)
  // 独立设置页（settings.section：官方设置导航；order 15 排在 Models 之后）。
  c.slots.inject('settings.section', () =>
    c.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-plus-usage-panel',
        order: 15,
        label: () => t('nav'),
        inject: () => ({ t }),
      },
      UsageSection,
    ),
  )

  // 价目卡片（三槽位注册，key/rowId 见 @dsh-plus/shared/client/config-slots）。
  const scope = createSettingsScope(c, 'dsh-plus-usage-panel', 'usage-panel: settings scope')
  const api = createNamespaceApi(c.get('remote').settings, 'dsh-plus-usage-panel')
  injectPluginConfigCard(c.slots, {
    ns: 'dsh-plus-usage-panel',
    rowId: 'dsh-plus-usage-panel',
    pkg: '@dsh-plus/usage-panel',
    component: UsagePriceCard,
    inject: () => ({ t, scope, api }),
  })
}
