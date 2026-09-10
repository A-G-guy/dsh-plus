/**
 * 插件浏览器半用到的宿主窄面（slots / locale / remote / cordis 生命周期）。
 *
 * 为什么在此收编：浏览器半只用到官方 client 依赖树的很窄一面，为构建期类型引入
 * 整条依赖树不划算（各插件 tsdown 把 react 等保持 external）。故照 ScopeHostContext
 * 的既有做法声明窄面——但必须**只声明一次**：此前 5 个包各自手写一份逐字节相同的
 * 副本，任一处漂移都不会被任何检查发现。
 *
 * @module @dsh-plus/shared/client/plugin-context
 */
import type { SettingsRemoteFace } from './scope.ts'

/** 槽位服务窄面。 */
export interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

/**
 * 文案服务窄面。
 * @typeParam TKey - 该插件的文案键联合（各包 DictKey）；决定 bind 结果接受哪些键。
 */
export interface LocaleLike<TKey extends string = string> {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: TKey) => string
}

/** 远端服务窄面（settings RPC + 事件订阅）。 */
export interface RemoteLike {
  settings: SettingsRemoteFace
  $on(event: string, listener: (payload?: unknown) => void): () => void
}

/**
 * 插件浏览器半的宿主上下文窄面。
 * @typeParam TKey - 该插件的文案键联合，透传给 LocaleLike。
 */
export interface PluginClientContext<TKey extends string = string> {
  slots: SlotsLike
  locale: LocaleLike<TKey>
  get(key: 'remote'): RemoteLike
  on(event: string, listener: () => void): () => void
  effect(execute: () => () => void, label?: string): unknown
}
