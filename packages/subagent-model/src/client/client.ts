/**
 * 浏览器半入口：注册 locale 字典 + 向 settings.plugin.item 插槽注册「子代理模型配置」卡片。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 *
 * 类型说明：浏览器半只用到 slots/locale 的很窄一面，此处以最小本地接口声明，
 * 避免为构建期类型引入整条官方 client 依赖树；运行时契约以官方
 * dsh-client-ui-settings-plugins 的 settings.plugin.item 插槽为准。
 * rc7 起该插槽为 keyed 槽位：key 必须是卡片编辑的 settings 命名空间
 * （即服务端 settingsNamespace() 注册的同一字面量，见 ../ns.ts），
 * 官方配置页按此 key 与 Host 已注册命名空间配对分发。
 * @module @dsh-plus/subagent-model/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { SETTINGS_NS } from '../ns.ts'
import { SubagentModelCard } from './card.tsx'
import { en, NS, zh } from './i18n.ts'
import { injectStyle } from './styles.ts'

export const name = 'dsh-plus-subagent-model'

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
    'subagent-model: style',
  )
  c.effect(
    () => c.locale.register(NS, { zh, en }),
    'subagent-model: locale',
  )
  c.slots.inject('settings.plugin.item', () =>
    c.slots.register(
      {
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        order: 100,
        locale: NS,
        inject: () => ({ t: c.locale.bind(NS) }),
      },
      SubagentModelCard,
    ),
  )
}
