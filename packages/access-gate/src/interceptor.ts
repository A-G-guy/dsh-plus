/**
 * 围栏拦截器：对 webServer 服务做结构性包装，覆盖全部 HTTP/WS 流量。
 *
 * 机制（dsh-host-webserver 无中间件机制，路由分发必经以下三个面）：
 * 1. `match(pathname)` —— HTTP 分发总咽喉：patch 后**请求级**围栏判定——
 *    放行则返回原 route（handler 外包一层，route 对象本体不动，webserver
 *    拿到的是浅拷贝）；拒绝则返回内联拒绝 route（导航→token 输入页，其余→403；
 *    连「未知路径」的探测面也一并收敛）。与路由注册时序完全无关。
 * 2. `fallback` 字段 + `registerFallback` 方法 —— SPA index/静态资源：
 *    在位包装已注册的 fallback（frontend-static 先于本插件），并 patch
 *    方法兜底后续注册。
 * 3. `upgrades` Map 各 route 的 handler + `registerUpgrade` 方法 —— WS 升级
 *    双路径覆盖（先/后注册的条目都被拦截）。
 *
 * 与官方认证合并后的放行面：
 * - 凭据校验委托官方 `connection.requestRejection()`（officialAuth 注入）；
 * - 豁免：自有端点（/dsh-plus/gate/*）、PWA 安装资产（manifest/favicon）、
 *   官方令牌交换（GET /?token=，校验本身由官方 authorizeIndex 完成）；
 * - 未认证导航 → token 输入页（PWA 内同路径可用）；未认证非导航 → 403。
 *
 * 结构守卫：安装前校验字段形状（match 为函数、upgrades 为 Map 等），
 * 不符即 fail-loud 抛错（启动失败由 lifeboat 隔离止损，绝不静默 fail-open）。
 * 恢复：所有 patch 与在位 handler 替换均登记 undo，dispose/HMR 时完全还原。
 * @module access-gate/interceptor
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

import type { Context } from '@deepseek-ai/cordis'

import type { AccessGateConfig } from './config.ts'
import { decideGate, type GateRequest, isNavigationRequest } from './decision.ts'
import { GATE_ROUTE } from './routes.ts'
import { renderTokenPage } from './token-page.ts'

type HttpHandler = (req: IncomingMessage, res: ServerResponse) => unknown
type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => unknown
type UpgradeRoute = { path: string; handler: UpgradeHandler }

/** 围栏所需的最小 webServer 结构面（结构守卫的契约）。 */
export interface GateWebServer {
  match(pathname: string): unknown
  upgrades: Map<string, UpgradeRoute>
  fallback?: HttpHandler
  registerFallback(handler: HttpHandler): unknown
  registerUpgrade(route: UpgradeRoute): unknown
  [key: string]: unknown
}

export interface InterceptorDeps {
  config: () => AccessGateConfig
  /** 官方 browser-auth 校验（委托 connection.requestRejection；含官方 Host 围栏）。 */
  officialAuth: (req: IncomingMessage) => boolean
  /**
   * IP 信任自动登录的 cookie 铸造器：返回可直接写 Set-Cookie 的官方同款
   * cookie 串；无法铸造（密钥缺失/authority 不可得等）返回 null（fail-safe，
   * 调用方回退普通未认证路径）。仅在判定 autologin 时被调用。
   */
  autoLoginCookie?: (req: IncomingMessage) => string | null
  onBlock?: (message: string) => void
}

/** PWA 安装/图标资产：未认证也必须可达，否则浏览器无法安装 PWA。 */
const PWA_ASSETS: ReadonlySet<string> = new Set(['/manifest.webmanifest', '/favicon.svg'])

/** 是否围栏豁免路径（自有状态/管理端点 + PWA 安装资产）。 */
export function isExemptPath(pathname: string): boolean {
  return (
    pathname === GATE_ROUTE || pathname.startsWith(`${GATE_ROUTE}/`) || PWA_ASSETS.has(pathname)
  )
}

/** 官方令牌交换请求：GET / 且携带 token 查询参数（放行给官方 authorizeIndex 校验）。 */
export function isTokenExchange(req: IncomingMessage): boolean {
  if (req.method !== 'GET') return false
  const url = new URL(req.url ?? '/', 'http://x')
  return url.pathname === '/' && url.searchParams.has('token')
}

function toGateRequest(req: IncomingMessage): GateRequest {
  return {
    url: req.url ?? '/',
    method: req.method ?? 'GET',
    headers: req.headers,
    remoteAddress: req.socket?.remoteAddress,
  }
}

/** WS 升级拒绝：按官方同款 403 原始响应后关闭。 */
function rejectUpgrade(socket: Duplex, clientIp: string, log: (m: string) => void): void {
  socket.end(
    [
      'HTTP/1.1 403 Forbidden',
      'Connection: close',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Length: 9',
      '',
      'forbidden',
    ].join('\r\n'),
  )
  log(`blocked upgrade (${clientIp})`)
}

/** IP 信任自动登录的引导页：已落官方 cookie，纯客户端跳回干净首页。 */
function renderAutoLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>正在进入 - DeepSeek Harness</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #16181d; color: #e6e8ec;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Noto Sans CJK SC", sans-serif;
  }
  .card { width: min(92vw, 420px); padding: 32px 28px; border-radius: 14px; text-align: center;
    background: #1e2128; border: 1px solid #2e323c; box-shadow: 0 8px 32px rgba(0,0,0,.4); box-sizing: border-box; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #3d6dff; margin: 0 2px; animation: b 1s infinite ease-in-out; }
  .dot:nth-child(2) { animation-delay: .15s; } .dot:nth-child(3) { animation-delay: .3s; }
  @keyframes b { 0%,80%,100% { opacity:.25; transform:scale(.8); } 40% { opacity:1; transform:scale(1); } }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  p { margin: 0; font-size: 13px; color: #9aa1ad; }
</style>
</head>
<body>
  <div class="card">
    <h1><span class="dot"></span><span class="dot"></span><span class="dot"></span></h1>
    <h1>已自动登录</h1>
    <p>正在进入…（本设备已在信任名单，无需手动登录）</p>
  </div>
<script>location.replace('/')</script>
</body>
</html>`
}

/** 单请求围栏判定；放行 true / 拒绝（已写响应）false。 */
function passHttp(req: IncomingMessage, res: ServerResponse, deps: InterceptorDeps): boolean {
  const url = new URL(req.url ?? '/', 'http://x')
  if (isExemptPath(url.pathname) || isTokenExchange(req)) return true
  const decision = decideGate(toGateRequest(req), deps.config(), deps.officialAuth(req))
  if (decision.verdict === 'pass') return true
  const log = deps.onBlock ?? (() => {})
  if (decision.verdict === 'autologin') {
    const cookie = deps.autoLoginCookie?.(req)
    if (cookie !== null && cookie !== undefined) {
      if (isNavigationRequest(toGateRequest(req)) && !res.headersSent) {
        // 导航：落官方 cookie + 引导页跳回干净首页（浏览器后续请求自动携带）。
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'set-cookie': cookie,
        })
        res.end(renderAutoLoginPage())
        log(`auto-login ${req.method ?? '?'} ${req.url ?? '?'} (${decision.clientIp ?? 'unknown'})`)
        return false
      }
      // 非导航（API/静态资产）：cookie 可铸即放行——浏览器正常流程先导航落罐，
      // 直呼请求由官方 requestRejection 按其携带的 cookie 判定。
      return true
    }
    // 铸造失败（fail-safe）：导航回退 token 输入页，非导航落入下方 403。
    log(`auto-login skipped: cookie unavailable (${decision.clientIp ?? 'unknown'})`)
    if (isNavigationRequest(toGateRequest(req)) && !res.headersSent) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(renderTokenPage())
      return false
    }
  }
  if (decision.verdict === 'token-page' && !res.headersSent) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(renderTokenPage())
    log(`token page ${req.method ?? '?'} ${req.url ?? '?'}`)
    return false
  }
  if (!res.headersSent) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
  } else {
    res.end()
  }
  log(`blocked ${req.method ?? '?'} ${req.url ?? '?'} (${decision.clientIp ?? 'unknown'})`)
  return false
}

/** HTTP handler 包装体：先判定再派发。 */
function gatedHttp(handler: HttpHandler, deps: InterceptorDeps): HttpHandler {
  return async (req, res) => {
    if (!passHttp(req, res, deps)) return
    return handler(req, res)
  }
}

/** WS 升级包装体：拒绝时不进协议协商；IP 信任自动登录（cookie 可铸）放行。 */
function gatedUpgrade(handler: UpgradeHandler, deps: InterceptorDeps): UpgradeHandler {
  return (req, socket, head) => {
    if (isExemptPath(new URL(req.url ?? '/', 'http://x').pathname))
      return handler(req, socket, head)
    const decision = decideGate(toGateRequest(req), deps.config(), deps.officialAuth(req))
    if (decision.verdict === 'pass') return handler(req, socket, head)
    // IP 信任自动登录：cookie 可铸时放行（浏览器 WebSocket 会带此前导航落罐的
    // cookie；官方 requestRejection 由连接携带的 cookie 通过）。
    if (
      decision.verdict === 'autologin' &&
      deps.autoLoginCookie !== undefined &&
      deps.autoLoginCookie(req) !== null
    ) {
      return handler(req, socket, head)
    }
    rejectUpgrade(socket, decision.clientIp ?? 'unknown', deps.onBlock ?? (() => {}))
    return undefined
  }
}

/**
 * 安装围栏（结构包装 + fail-loud 守卫）。
 * @returns 恢复函数（调用方登记进 ctx.effect）。
 */
export function installGateInterceptor(
  ctx: Context,
  server: GateWebServer,
  deps: InterceptorDeps,
): () => void {
  assertGateStructure(server)
  const restores: Array<{ undo(): void }> = []

  // 1. match：HTTP 总咽喉——请求级判定；返回浅拷贝 route（handler 已包 gate），
  //    原 route 对象与注册表不动，杜绝重复包装。
  //    未命中任何路由时必须返回 undefined：webserver 的 handle() 据此转入
  //    fallback 原生路径（fallback 已被第 2 步包装，SPA 语义完整保留）。
  const originalMatch = server.match.bind(server)
  const gatedMatch = (pathname: string): unknown => {
    if (isExemptPath(pathname)) return originalMatch(pathname)
    const config = deps.config()
    if (!config.enabled) return originalMatch(pathname)
    const route = originalMatch(pathname) as { handler: HttpHandler } | undefined
    if (route === undefined) return undefined
    return { ...route, handler: gatedHttp(route.handler, deps) }
  }
  server.match = gatedMatch as typeof server.match
  restores.push({
    undo: () => {
      server.match = originalMatch as typeof server.match
    },
  })

  // 2. fallback 在位包装 + registerFallback 兜底（浅拷贝 route 不覆盖
  //    fallback 场景：webserver 对未命中请求直接调 this.fallback）。
  const wrapFallback = (handler: HttpHandler): HttpHandler => gatedHttp(handler, deps)
  const originalFallback = server.fallback
  let fallbackReplaced = false
  if (originalFallback !== undefined) {
    server.fallback = wrapFallback(originalFallback) as typeof originalFallback
    fallbackReplaced = true
  }
  const originalRegisterFallback = server.registerFallback.bind(server)
  const patchedRegisterFallback = (handler: HttpHandler): unknown =>
    originalRegisterFallback(wrapFallback(handler))
  server.registerFallback = patchedRegisterFallback as typeof server.registerFallback
  restores.push({
    undo: () => {
      server.registerFallback = originalRegisterFallback as typeof server.registerFallback
      if (fallbackReplaced) server.fallback = originalFallback as typeof server.fallback
    },
  })

  // 3. upgrades：在位包装已注册条目 + patch registerUpgrade（后续注册）。
  const wrapped = new Map<UpgradeRoute, UpgradeHandler>()
  const wrapUpgradeRoute = (route: UpgradeRoute): void => {
    wrapped.set(route, route.handler)
    route.handler = gatedUpgrade(route.handler, deps)
  }
  for (const route of server.upgrades.values()) wrapUpgradeRoute(route)
  const originalRegisterUpgrade = server.registerUpgrade.bind(server)
  const patchedRegisterUpgrade = (route: UpgradeRoute): unknown => {
    const disposer = originalRegisterUpgrade(route)
    // 未抛重复错即注册成功；在位包装（Map 值 === route 已证其已入表）。
    if (server.upgrades.get(route.path) === route) wrapUpgradeRoute(route)
    return disposer
  }
  server.registerUpgrade = patchedRegisterUpgrade as typeof server.registerUpgrade
  restores.push({
    undo: () => {
      server.registerUpgrade = originalRegisterUpgrade as typeof server.registerUpgrade
      for (const [route, handler] of wrapped) route.handler = handler
      wrapped.clear()
    },
  })

  const undo = (): void => {
    // 逆序还原（后装先撤）；forEach 直接取项，免去索引访问的 undefined 分支。
    for (const restore of [...restores].reverse()) restore.undo()
  }
  void ctx
  return undo
}

/** 结构守卫：字段形状不符即抛错（fail-loud）。 */
export function assertGateStructure(server: GateWebServer): void {
  if (typeof server.match !== 'function')
    throw new Error('access-gate: webServer.match is not a function (upstream shape changed)')
  if (!(server.upgrades instanceof Map))
    throw new Error('access-gate: webServer.upgrades is not a Map (upstream shape changed)')
  if (typeof server.registerFallback !== 'function')
    throw new Error(
      'access-gate: webServer.registerFallback is not a function (upstream shape changed)',
    )
  if (typeof server.registerUpgrade !== 'function')
    throw new Error(
      'access-gate: webServer.registerUpgrade is not a function (upstream shape changed)',
    )
}
