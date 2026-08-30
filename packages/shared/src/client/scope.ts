/**
 * 浏览器半 settings scope 的最小本地接口声明（各插件 client 的公共收编版）。
 * 只声明插件用到的窄面，避免为构建期类型引入整条官方 client 依赖树。
 *
 * 0.1.2-alpha.1 起 `connection.api.settings` RPC 面被移除（dsh-host-apiproxy
 * 删除），配置读写统一走 `ctx.remote.settings`（Typert Remote 命名空间）：
 * `describe()` 无参直返视图、`update/replace` 位置参数、错误一律 throw。
 * 官方 `settingsScope.bind` 在非 loopback 页面固定 memory 模式（构造时按
 * `connection.isLoopback` 定死），remote-settings 的修复只翻 describe mirror，
 * 对已绑定 scope 无效——故插件配置读写仍直连 remote.settings，保证任意
 * origin（loopback / tailnet 信任域名）下行为一致。
 * @module @dsh-plus/shared/client/scope
 */

/** settings 命名空间 scope 的快照（官方 SettingsScopeSnapshot 的最小投影）。 */
export interface ScopeSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  /** schema 解析后的配置值（secret 字段已脱敏剥除）。 */
  value: unknown
  /** 命名空间 revision，写操作 fencing 用；首次 Host 应答前为 undefined。 */
  revision: number | undefined
  /** Host 文档是否可写。 */
  writable: boolean
}

/** 命名空间 scope 的控制器面（由 createSettingsScope 以 remote.settings 直连实现）。 */
export interface Scope {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<void>
}

/** 官方 SettingsNamespaceView 的最小投影（secrets 用于「已配置」探测）。 */
export interface SettingsNamespaceViewLike {
  ns: string
  value: unknown
  revision: number
  secrets: Array<{ path: string[]; set: boolean }>
}

/** 官方 SettingsDescribeValue 的最小投影（describe 信封 value 面）。 */
export interface SettingsDescribeViewLike {
  writable: boolean
  namespaces: SettingsNamespaceViewLike[]
}

/** Typert Remote 应答信封：逻辑失败走 `{ok:false, error}`，传输异常才 throw。 */
export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { message?: string } }

/** `ctx.remote.settings` 的 RPC 面（插件用到的两个方法；RemoteResult 信封）。 */
export interface SettingsRemoteFace {
  describe(): Promise<RemoteResult<SettingsDescribeViewLike>>
  update(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<RemoteResult<unknown>>
}

/** createSettingsScope 依赖的浏览器半 ctx 窄面。 */
// 注意：cordis 关联访问器要求 inject 同时声明 'remote' 与 'remote.settings'
//（对 remote 服务取 .settings 子面会走 'remote.settings' 的 inject 检查）。
export interface ScopeHostContext {
  get(key: 'remote'): {
    settings: SettingsRemoteFace
    $on(event: string, listener: (payload?: unknown) => void): () => void
  }
  on(event: string, listener: () => void): () => void
  effect(execute: () => () => void, label?: string): unknown
}

/**
 * remote.settings 直连实现的命名空间 scope（官方配置页 tab 同款模式）。
 * 读：describe 取命名空间视图（脱敏 value/revision + 顶层 writable）；
 * 刷新：remote `settings/document-updated`（按命名空间过滤）与
 * `connection/reset`；generation 防旧读覆盖新发布。任何页面 origin
 * （loopback 或 tailnet 信任域名）下行为一致。
 * effect 归属调用方 fiber（label 需含插件名以便诊断）。
 */
export function createSettingsScope(c: ScopeHostContext, ns: string, label: string): Scope {
  const remote = c.get('remote')
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
    let view: SettingsDescribeViewLike
    try {
      const response = await remote.settings.describe()
      if (!response.ok) return
      view = response.value
    } catch {
      return
    }
    if (gen !== generation) return
    const namespace = view.namespaces.find((candidate) => candidate.ns === ns)
    if (namespace === undefined) {
      publish({
        status: 'unavailable',
        value: undefined,
        revision: undefined,
        writable: view.writable,
      })
      return
    }
    publish({
      status: 'ready',
      value: namespace.value,
      revision: namespace.revision,
      writable: view.writable,
    })
  }
  const refresh = (namespace?: unknown): void => {
    if (namespace !== undefined && namespace !== ns) return
    void load()
  }
  const disposers = [
    remote.$on('settings/document-updated', refresh),
    c.on('connection/reset', () => {
      void load()
    }),
  ]
  c.effect(
    () => () => {
      for (const dispose of disposers) dispose()
    },
    label,
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

/**
 * 绑定到单一命名空间的写/探活面（卡片 props 用）。
 * `update` 把信封逻辑失败（ok:false）与传输异常统一转 throw；`describe`
 * 拆信封直返视图（失败 throw），供 secrets「已配置」探测（快照面不含
 * secrets，必须走 describe）。
 */
export interface NamespaceSettingsApi {
  update(patch: Record<string, unknown>, expectedRevision?: number): Promise<void>
  describe(): Promise<SettingsDescribeViewLike>
}

/** 以 remote.settings 构造命名空间绑定的 api 面。 */
export function createNamespaceApi(remote: SettingsRemoteFace, ns: string): NamespaceSettingsApi {
  return {
    update: async (patch, expectedRevision) => {
      const response = await remote.update(ns, patch, expectedRevision)
      if (!response.ok) {
        throw new Error(response.error.message ?? 'settings update failed')
      }
    },
    describe: async () => {
      const response = await remote.describe()
      if (!response.ok) {
        throw new Error(response.error.message ?? 'settings describe failed')
      }
      return response.value
    },
  }
}
