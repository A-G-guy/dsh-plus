/**
 * 浏览器半入口：注册 locale 字典 + 向 settings.plugin.item 插槽注册「访问控制」卡片。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 *
 * 类型说明：浏览器半只用到 slots/locale/connection/remote 的很窄一面，
 * 此处以最小本地接口声明（见 ./scope.ts），避免为构建期类型引入整条官方
 * client 依赖树；运行时契约以官方 dsh-client-ui-settings-plugins 的
 * settings.plugin.item 插槽与 dsh-client-connection 的 settings RPC 面为准。
 * rc7 起该插槽为 keyed 槽位：key 必须是卡片编辑的 settings 命名空间
 * （即服务端 settingsNamespace() 注册的同一字面量，见 ../ns.ts），
 * 官方配置页按此 key 与 Host 已注册命名空间配对分发。
 * 配置读写经官方 settings RPC 直连（rc7 起第三方命名空间全量开放；
 * 不复用 settingsScope 服务——非 loopback 页面下它无数据，见 scope.ts）。
 * @module @dsh-plus/access-gate/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { SETTINGS_NS } from '../ns.ts'
import { AccessGateCard } from './card.tsx'
import { en, NS, zh } from './i18n.ts'
import type { Scope, ScopeSnapshot, SettingsApi } from './scope.ts'
import { injectStyle } from './styles.ts'

export const name = 'dsh-plus-access-gate'

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
  api: { settings: SettingsApi }
}

interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
  get(key: 'connection'): ConnectionLike
  get(key: 'remote'): RemoteLike
  on(event: string, listener: () => void): () => void
  effect(execute: () => () => void, label?: string): unknown
}

/**
 * api 直连实现的命名空间 scope（官方配置页 tab 同款模式）。
 * 读：describe 取命名空间视图（脱敏 value/revision + 顶层 writable）；
 * 刷新：remote `settings/document-updated`（按命名空间过滤）与
 * `connection/reset`；generation 防旧读覆盖新发布。任何页面 origin
 * （loopback 或 tailnet 信任域名）下行为一致。
 */
function createApiScope(api: SettingsApi, ns: string, c: ClientContext): Scope {
  let state: ScopeSnapshot = {
    status: 'loading',
    value: undefined,
    revision: undefined,
    writable: false,
  }
  const listeners = new Set<() => void>()
  let generation = 0
  const publish = (next: ScopeSnapshot): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  const load = async (): Promise<void> => {
    const gen = ++generation
    let response: Awaited<ReturnType<SettingsApi['describe']>>
    try {
      response = await api.describe({})
    } catch {
      return
    }
    if (gen !== generation || !response.result.ok) return
    const writable = response.result.value?.writable ?? false
    const view = response.result.value?.namespaces.find((candidate) => candidate.ns === ns)
    if (view === undefined) {
      publish({
        status: 'unavailable',
        value: undefined,
        revision: undefined,
        writable,
      })
      return
    }
    publish({
      status: 'ready',
      value: view.value,
      revision: view.revision,
      writable,
    })
  }
  const refresh = (namespace?: unknown): void => {
    if (namespace !== undefined && namespace !== ns) return
    void load()
  }
  const disposers = [
    c.get('remote').$on('settings/document-updated', refresh),
    c.on('connection/reset', () => {
      void load()
    }),
  ]
  c.effect(
    () => () => {
      for (const dispose of disposers) dispose()
    },
    'access-gate: settings scope',
  )
  void load()
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    load,
  }
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
  const api = c.get('connection').api.settings
  const scope = createApiScope(api, SETTINGS_NS, c)
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
