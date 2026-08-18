/**
 * 浏览器半入口：注册 locale 字典 + 向 settings.plugin.item 插槽注册「LLM 路由」卡片。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 *
 * 类型说明：浏览器半只用到 slots/locale/settingsScope/connection 的很窄一面，
 * 此处以最小本地接口声明（见 ./scope.ts），避免为构建期类型引入整条官方
 * client 依赖树；运行时契约以官方 dsh-client-ui-settings-plugins 的
 * settings.plugin.item 插槽与 dsh-client-ui-settings 的 settingsScope 服务为准。
 * rc7 起该插槽为 keyed 槽位：key 必须是卡片编辑的 settings 命名空间
 * （即服务端 settingsNamespace() 注册的同一字面量，见 ../ns.ts），
 * 官方配置页按此 key 与 Host 已注册命名空间配对分发。
 * 配置读写经官方 settingsScope 传输（rc7 起第三方命名空间对 settings RPC
 * 全量开放）；自定义端点仅剩「模型目录」（api.ts，含 kitSource/models-dev
 * 运行期诊断）。
 * @module @dsh-plus/llm-pi/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { SETTINGS_NS } from '../ns.ts'
import { LlmPiCard } from './card.tsx'
import { en, NS, zh } from './i18n.ts'
import type { Scope, SettingsApi } from './scope.ts'
import { injectStyle } from './styles.ts'

export const name = 'dsh-plus-llm-pi'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale', 'settingsScope', 'connection'] as const

interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

interface SettingsScopeServiceLike {
  bind(spec: { namespace: string }): Scope
}

interface ConnectionLike {
  settings: SettingsApi
}

interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
  settingsScope: SettingsScopeServiceLike
  get(key: 'connection'): ConnectionLike
  effect(execute: () => () => void, label?: string): unknown
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const tag = injectStyle()
  c.effect(
    () => () => {
      tag?.remove()
    },
    'llm-pi: style',
  )
  c.effect(
    () => c.locale.register(NS, { zh, en }),
    'llm-pi: locale',
  )
  const scope = c.settingsScope.bind({ namespace: SETTINGS_NS })
  const api = c.get('connection').api.settings
  c.slots.inject('settings.plugin.item', () =>
    c.slots.register(
      {
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        locale: NS,
        inject: () => ({ t: c.locale.bind(NS), scope, api }),
      },
      LlmPiCard,
    ),
  )
}
