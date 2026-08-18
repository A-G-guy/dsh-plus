/**
 * 浏览器半 settingsScope/connection 的最小本地接口声明。
 * 只声明本插件用到的窄面，避免为构建期类型引入整条官方 client 依赖树；
 * 运行时契约以官方 dsh-client-ui-settings 的 settingsScope 服务与
 * dsh-client-connection 的 settings RPC 面为准（rc7：白名单已移除，
 * 任何已注册命名空间均可 describe/update/replace）。
 * @module llm-pi/client/scope
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

/** settingsScope.bind({namespace}) 返回的控制器面。 */
export interface Scope {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<void>
}

/** connection api.settings 的 RPC 面（本插件用到的三个方法）。 */
export interface SettingsApi {
  describe(): Promise<{ result: { ok: boolean; value?: { namespaces: Array<{ ns: string; secrets: Array<{ path: string[]; set: boolean }> }> }; error?: { message?: string } } }>
  update(request: { ns: string; patch: Record<string, unknown>; expectedRevision?: number }): Promise<{ result: { ok: boolean; error?: { message?: string } } }>
  replace(request: { ns: string; section: Record<string, unknown>; expectedRevision?: number }): Promise<{ result: { ok: boolean; error?: { message?: string } } }>
}
