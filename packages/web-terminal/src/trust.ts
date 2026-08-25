/**
 * 请求信任校验：Origin/Host 一致性（DNS rebinding 与跨站 WS 防护）。
 *
 * 终端是 RCE 级暴露面，比 web-files 更严：携带 Origin 的请求（浏览器
 * fetch/WebSocket 必带）其 authority 必须与 Host 头完全一致；不带 Origin
 * 的非浏览器客户端沿官方 /api 围栏的 loopback/trustedHosts 语义——由
 * access-gate 围栏与 `web-terminal/access` 接缝兜底，本模块只做同源判定。
 * @module web-terminal/trust
 */
import type { IncomingMessage } from 'node:http'

/** Origin 与 Host 的 authority 是否一致（端口敏感，双方 WHATWG 规范化）。 */
export function originMatchesHost(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  const host = req.headers.host
  if (host === undefined || host.length === 0) return false
  let originAuthority: string | null = null
  try {
    originAuthority = new URL(origin).host
  } catch {
    return false
  }
  if (originAuthority.length === 0) return false
  let hostAuthority: string
  try {
    hostAuthority = new URL(`http://${host}`).host
  } catch {
    return false
  }
  return originAuthority === hostAuthority
}

/** 组合判定：Origin 一致性不通过即拒绝（供 HTTP 与 WS 升级共用）。 */
export function isTrustedRequest(req: IncomingMessage): boolean {
  return originMatchesHost(req)
}

/** JSON POST 的 content-type 判定（宽容 charset 后缀）。 */
export function isJsonRequest(req: IncomingMessage): boolean {
  const raw = req.headers['content-type'] ?? ''
  const mime = raw.split(';')[0]?.trim().toLowerCase()
  return mime === 'application/json'
}
