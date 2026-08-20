/**
 * 浏览器半 settingsScope/connection 的最小本地接口声明。
 * 只声明本插件用到的窄面，避免为构建期类型引入整条官方 client 依赖树；
 * 运行时契约以官方 dsh-client-connection 的 settings RPC 面为准
 * （rc7：白名单已移除，任何已注册命名空间均可 describe/update/replace）。
 *
 * 实现说明：本插件不复用 settingsScope 服务的 bind()——它在非 loopback
 * 页面（如经 tailnet 域名访问）下走 memory 模式、永远无数据；这里按官方
 * 配置页 tab 的同款模式用 `api.settings` 直连实现 Scope（describe 读 +
 * remote `settings/document-updated` / `connection/reset` 刷新，见 client.ts）。
 * @module notify-email/client/scope
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

/** settingsScope.bind({namespace}) 返回的控制器面（本插件由 api 直连实现）。 */
export interface Scope {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<void>
}

/** connection api.settings 的 RPC 面（本插件用到的三个方法）。 */
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
