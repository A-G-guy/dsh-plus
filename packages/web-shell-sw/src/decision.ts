/**
 * Service Worker 路由决策纯函数（node 与浏览器两侧共用同一份实现）：
 *
 * - `decideFetchAction`：SW fetch 事件该不该 `respondWith`、用哪种策略。
 *   安全底线——只有同源 GET、非 Range、内容寻址静态资源与无查询串的
 *   index 才进缓存路径；SSE（/plugins/events）、RPC、网关路由、token 交换
 *   （`/?token=` 带查询串）一律 passthrough（不调 respondWith = 浏览器
 *   原生行为，零干预）。
 * - `decideClientAction`：浏览器半启动时该注册、该注销还是跳过。
 *
 * 该模块无闭包依赖，函数体自包含——`decideFetchAction.toString()` 会被
 * 内嵌进生成的 sw.js（见 sw-script.ts），测试同时验证内嵌前后行为一致。
 * @module @dsh-plus/web-shell-sw/decision
 */

/** 单个 fetch 事件的处置。 */
export type SwFetchAction =
  | 'passthrough' /** 不 respondWith：浏览器原生处理（RPC/SSE/token/跨格式一律走此道） */
  | 'cache-first' /** 内容寻址静态资源：缓存命中即回，未命中回源并按策略入库 */
  | 'network-first-shell' /** 无查询串的 index：网络优先，仅网络失败时才用缓存兜底 */

/**
 * 决定一个 fetch 事件的处置（自包含纯函数，会被 toString 内嵌进 sw.js）。
 * @param method - HTTP 方法（大写）。
 * @param pathname - 已剥查询串的路径。
 * @param hasSearch - URL 是否带查询串（token 交换 `/?token=` 必须原生直通）。
 * @param hasRange - 请求是否带 Range 头（分段请求不走整包缓存）。
 */
export function decideFetchAction(
  method: string,
  pathname: string,
  hasSearch: boolean,
  hasRange: boolean,
): SwFetchAction {
  if (method !== 'GET') return 'passthrough'
  if (hasRange) return 'passthrough'
  if (pathname === '/' || pathname === '/index.html') {
    return hasSearch ? 'passthrough' : 'network-first-shell'
  }
  if (pathname === '/plugins/events') return 'passthrough'
  if (pathname.startsWith('/assets/')) return 'cache-first'
  if (pathname.startsWith('/plugins/')) return 'cache-first'
  return 'passthrough'
}

/** 浏览器半启动处置。 */
export type ClientAction =
  | 'register' /** 注册（幂等；无注册则新建，有则触发更新检查） */
  | 'cleanup' /** 注销已注册 SW 并清空本插件缓存（禁用恢复原生行为） */
  | 'skip' /** 无配置行（插件缺席）或环境不支持（非安全上下文/无 SW） */

/**
 * 决定浏览器半启动动作。
 * @param config - 注入的配置行（缺席 = 插件未装配，零行为）。
 * @param env - 运行环境（安全上下文且支持 serviceWorker 才可操作）。
 */
export function decideClientAction(
  config: { readonly enabled?: boolean } | undefined,
  env: { readonly isSecureContext: boolean; readonly hasServiceWorker: boolean },
): ClientAction {
  if (config === undefined) return 'skip'
  if (!env.isSecureContext || !env.hasServiceWorker) return 'skip'
  return config.enabled === true ? 'register' : 'cleanup'
}
