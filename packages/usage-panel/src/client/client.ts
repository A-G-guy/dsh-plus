/**
 * 浏览器半入口：
 * - settings.section 官方插槽注册「用量统计」独立设置页；
 * - settings.plugin.item keyed 槽位注册价目卡片（key = dsh-plus-usage-panel）。
 * @module @dsh-plus/usage-panel/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { createApiScope } from '@dsh-plus/shared/client'
import { en, NS, zh } from './i18n.ts'
import { UsagePriceCard } from './price-card.tsx'
import { UsageSection } from './section.tsx'
import { injectCardStyles, injectSectionStyle } from './styles.ts'

export const name = 'dsh-plus-usage-panel'

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

  // 价目卡片（settings.plugin.item：keyed 槽位，key = settings 命名空间）。
  const api = c.get('connection').api.settings
  const scope = createApiScope(api, 'dsh-plus-usage-panel', c, 'usage-panel: settings scope')
  c.slots.inject('settings.plugin.item', () =>
    c.slots.register(
      {
        name: 'settings.plugin.item',
        key: 'dsh-plus-usage-panel',
        locale: NS,
        inject: () => ({ t, scope, api }),
      },
      UsagePriceCard,
    ),
  )
}
