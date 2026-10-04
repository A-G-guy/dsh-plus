/**
 * 浏览器半入口：注册 locale 字典 + 注册「Actual Budget 连接」卡片
 * （injectPluginConfigCard 两槽位：插件页 plugins.row.config /
 * plugins.bundle.config）。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 * 配置读写经 ctx.remote.settings 直连（scope/api 来自 @dsh-plus/shared/client），
 * 密钥读写经 ctx.remote.credentials（官方 settings-controller 的凭据命名空间）。
 * @module @dsh-plus/actual/client
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  createNamespaceApi,
  createSettingsScope,
  injectPluginConfigCard,
  type PluginClientContext,
  type RemoteLike,
} from '@dsh-plus/shared/client'

import { SETTINGS_NS } from '../ns.ts'
import { ActualCard } from './card.tsx'
import { type DictKey, en, NS, zh } from './i18n.ts'
import type { CredentialsRemoteFace } from './secrets.ts'
import { injectStyle } from './styles.ts'

export const name = 'dsh-plus-actual'

/**
 * 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。
 * `remote.credentials` 为硬依赖：卡片是密钥的唯一配置面，命名空间缺席时整张卡片
 * 都不该挂（官方设置页同样如此声明）。
 */
export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.settings',
  'remote.credentials',
] as const

/** 宿主窄面收编在 @dsh-plus/shared/client；TKey 传入本包 DictKey 使键名受检。 */
type ClientContext = PluginClientContext<DictKey>

/** `remote` 服务加上凭据命名空间（inject 已声明，故按存在处理）。 */
type RemoteWithCredentials = RemoteLike & {
  credentials: Omit<CredentialsRemoteFace, 'onChange'>
}

/**
 * 把官方 `remote.credentials` 收成窄面：只补一个把宿主事件包成订阅的方法，
 * 让状态层不必认识 `$on` 的事件名与载荷形状。
 */
function credentialsFace(c: ClientContext): CredentialsRemoteFace {
  const remote = c.get('remote') as RemoteWithCredentials
  const { credentials } = remote
  return {
    describe: (refs) => credentials.describe(refs),
    set: (ref, value) => credentials.set(ref, value),
    unset: (ref) => credentials.unset(ref),
    onChange: (listener) =>
      remote.$on('credentials/reference-updated', (ref) => {
        if (typeof ref === 'string') listener(ref)
      }),
  }
}

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
  const credentials = credentialsFace(c)
  injectPluginConfigCard(c.slots, {
    ns: SETTINGS_NS,
    rowId: 'dsh-plus-actual',
    pkg: '@dsh-plus/actual',
    component: ActualCard,
    inject: () => ({ t: c.locale.bind(NS), scope, api, credentials }),
  })
}
