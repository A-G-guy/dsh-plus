/**
 * 缓存头决策（纯函数，零 IO）：给定请求方法、URL、响应状态与「响应是否已带
 * cache-control」，决定是否补 immutable 长缓存头。
 *
 * 命中条件（全部满足，缺一即不干预）：
 * - 方法为 GET/HEAD（静态资源读取语义；写操作永不缓存）；
 * - 响应状态恰为 200（错误/重定向/未修改一律不加，避免缓存污染）；
 * - 路径以 `/assets/` 前缀（带段边界：`/assets` 根与 `/assetsX` 均不命中）；
 * - 调用方（含 core 未来版本自带的策略）未设置过 cache-control —— 纯增量，
 *   已有策略永远优先。
 *
 * 为什么只认 `/assets/`：dsh 前端 dist（Vite 产物）全部文件内容哈希命名
 * （JS/CSS/字体/语言包已逐一核实），URL 即内容地址，immutable 安全；
 * `/plugins/*` 由 core 自带 `public, max-age=31536000, immutable`
 * （dsh-client-modules 的 IMMUTABLE_CACHE），不在此重复；index.html /
 * favicon / manifest 保持 dsh 原生行为（不缓存），确保插件清单与 rev 每次最新。
 * @module @dsh-plus/web-cache-headers/decision
 */

/** 与 dsh-client-modules 的 IMMUTABLE_CACHE 保持逐字节一致。 */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** dsh 前端 dist 挂载点（段边界即末尾斜杠：排除 `/assetsX` 与 `/assets` 根）。 */
const HASHED_ASSETS_PREFIX = '/assets/'

/** 取 origin-form URL 的路径部分（剥查询串；HTTP 请求行不含 hash）。 */
export function pathnameOf(url: string): string {
  const queryAt = url.indexOf('?')
  return queryAt === -1 ? url : url.slice(0, queryAt)
}

/**
 * 决策一个响应是否补 immutable 缓存头。
 * @param method - 请求方法（HTTP 方法大写敏感，按请求行原样传入）。
 * @param url - 请求 URL（origin-form，可带查询串）。
 * @param statusCode - 待写入的响应状态码。
 * @param hasCacheControl - 响应是否已带 cache-control（setHeader 或 writeHead 头对象任一）。
 * @returns 应写入的缓存头值；不干预时返回 undefined。
 */
export function decideCacheControl(
  method: string,
  url: string,
  statusCode: number,
  hasCacheControl: boolean,
): string | undefined {
  if (hasCacheControl) return undefined
  if (method !== 'GET' && method !== 'HEAD') return undefined
  if (statusCode !== 200) return undefined
  if (!pathnameOf(url).startsWith(HASHED_ASSETS_PREFIX)) return undefined
  return IMMUTABLE_CACHE_CONTROL
}
