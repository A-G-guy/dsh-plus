/**
 * 浏览器半入口：注册 locale 字典 + 向 settings.plugin.item 插槽注册「功能开关」卡片。
 * 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory bundle
 * （包装见 tsdown.config.ts）；样式沿用官方 data-plugin-css 约定，HMR 据此卸载。
 *
 * 配置读写走官方 settings RPC（rc7 起第三方命名空间全量开放，notify-email 同款
 * api 直连 scope）；生效状态/journal 经自建端点轮询（api.ts）。
 * @module @dsh-plus/feature-toggle/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { SETTINGS_NS } from '../ns.ts'
import { FeatureToggleCard } from './card.tsx'
import { en, NS, zh } from './i18n.ts'
import type { Scope, ScopeSnapshot, SettingsApi } from './scope.ts'
import { injectStyle } from './styles.ts'

export const name = 'dsh-plus-feature-toggle'

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

/** api 直连实现的命名空间 scope（notify-email 同款模式）。 */
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
      publish({ status: 'unavailable', value: undefined, revision: undefined, writable })
      return
    }
    publish({ status: 'ready', value: view.value, revision: view.revision, writable })
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
    'feature-toggle: settings scope',
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
    'feature-toggle: style',
  )
  c.effect(() => c.locale.register(NS, { zh, en }), 'feature-toggle: locale')
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
      FeatureToggleCard,
    ),
  )
}
