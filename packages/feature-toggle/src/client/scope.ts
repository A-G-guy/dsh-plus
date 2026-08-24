/**
 * 浏览器半 settingsScope/connection 的最小本地接口声明（notify-email 同款）。
 * 运行时契约以官方 dsh-client-connection 的 settings RPC 面为准。
 * @module feature-toggle/client/scope
 */

/** settings 命名空间 scope 的快照。 */
export interface ScopeSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  /** schema 解析后的配置值。 */
  value: unknown
  /** 命名空间 revision，写操作 fencing 用。 */
  revision: number | undefined
  /** Host 文档是否可写。 */
  writable: boolean
}

export interface Scope {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<void>
}

export interface SettingsApi {
  describe(payload?: Record<string, never>): Promise<{
    result: {
      ok: boolean
      value?: {
        writable: boolean
        namespaces: Array<{ ns: string; value: unknown; revision: number }>
      }
      error?: { message?: string }
    }
  }>
  update(request: {
    ns: string
    patch: Record<string, unknown>
    expectedRevision?: number
  }): Promise<{ result: { ok: boolean; error?: { message?: string } } }>
}
