/**
 * 浏览器半 settingsScope/connection 的最小本地接口声明（各插件 client 的
 * 公共收编版；原 notify-email/llm-pi/access-gate/subagent-model 四份副本）。
 * 只声明插件用到的窄面，避免为构建期类型引入整条官方 client 依赖树；
 * 运行时契约以官方 dsh-client-connection 的 settings RPC 面为准
 * （rc7：白名单已移除，任何已注册命名空间均可 describe/update/replace）。
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

/** 命名空间 scope 的控制器面（由 createApiScope 以 api 直连实现）。 */
export interface Scope {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<void>
}

/** connection api.settings 的 RPC 面（插件用到的三个方法）。 */
export interface SettingsApi {
  describe(payload?: Record<string, never>): Promise<{
    result: {
      ok: boolean
      value?: {
        writable: boolean
        namespaces: Array<{
          ns: string
          value: unknown
          revision: number
          secrets: Array<{ path: string[]; set: boolean }>
        }>
      }
      error?: { message?: string }
    }
  }>
  update(request: {
    ns: string
    patch: Record<string, unknown>
    expectedRevision?: number
  }): Promise<{ result: { ok: boolean; error?: { message?: string } } }>
  replace(request: {
    ns: string
    section: Record<string, unknown>
    expectedRevision?: number
  }): Promise<{ result: { ok: boolean; error?: { message?: string } } }>
}

/** createApiScope 依赖的浏览器半 ctx 窄面（各插件 client.ts 已有同款声明）。 */
export interface ScopeHostContext {
  get(key: 'remote'): { $on(event: string, listener: (payload?: unknown) => void): () => void }
  on(event: string, listener: () => void): () => void
  effect(execute: () => () => void, label?: string): unknown
}

/**
 * api 直连实现的命名空间 scope（官方配置页 tab 同款模式）。
 * 读：describe 取命名空间视图（脱敏 value/revision + 顶层 writable）；
 * 刷新：remote `settings/document-updated`（按命名空间过滤）与
 * `connection/reset`；generation 防旧读覆盖新发布。任何页面 origin
 * （loopback 或 tailnet 信任域名）下行为一致。
 * effect 归属调用方 fiber（label 需含插件名以便诊断）。
 */
export function createApiScope(
  api: SettingsApi,
  ns: string,
  c: ScopeHostContext,
  label: string,
): Scope {
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
