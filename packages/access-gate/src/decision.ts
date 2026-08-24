/**
 * 围栏判定核心：`decideGate` 纯函数。
 *
 * 信任模型（决策记录详见 docs/README.md）：
 * - dsh web 仅绑 127.0.0.1，远程流量必经 tailscale serve → dsh-proxy 两跳，
 *   serve 会**覆盖**（而非追加）x-forwarded-for，客户端无法伪造；
 * - 能直发 loopback 或伪造 XFF 的只有本机进程——与 dsh 官方 /api 围栏的
 *   loopback 信任边界一致，本机直连视为可信管理通道；
 * - 因此 XFF 存在且 trustForwardedFor=true 时取最左条目为真实客户端 IP。
 *
 * token 比较使用 sha256 摘要 + timingSafeEqual 常时比较。
 * @module access-gate/decision
 */
import { createHash, timingSafeEqual } from 'node:crypto'

import type { GatePolicy } from './config.ts'
import { isLoopbackAddress, parseAllowEntry, parseIp } from './ip.ts'

export const GATE_COOKIE = 'dsh_gate'

/** 围栏判定结果。 */
export type GateVerdict =
  | 'pass' /** 放行（本机直连 / 白名单 IP / 有效 token） */
  | 'block' /** 拒绝：API / WebSocket 等非导航请求 → 403 */
  | 'login' /** 拒绝：浏览器导航请求 → 登录页 */

/** 判定输出。 */
export interface GateDecision {
  verdict: GateVerdict
  /** 还原出的客户端 IP（有 XFF 或非 loopback 直连时存在）。 */
  clientIp?: string
  /** 放行原因（诊断/日志用）：local / allowed-ip / token。 */
  reason?: 'local' | 'allowed-ip' | 'token'
  /** 无效白名单条目（卡片诊断用，判定时忽略它们）。 */
  invalidEntries?: string[]
}

/** 判定输入的请求事实（headers 小写键，node:http 原生形态）。 */
export interface GateRequest {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, unknown>
  readonly remoteAddress?: string
}

/** sha256 摘要为定长 32 字节，常时比较的前提。 */
function tokenMatches(candidate: string, expected: string): boolean {
  if (candidate === '' || expected === '') return false
  const a = createHash('sha256').update(candidate).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** 从 cookie 头解析指定名字的值（手写最小解析，零依赖）。 */
export function readCookie(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers.cookie
  if (typeof raw !== 'string') return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim()
      return value === '' ? undefined : value
    }
  }
  return undefined
}

/** 取 XFF 最左条目（serve 单跳覆盖语义下即真实客户端 IP）。 */
function forwardedIp(headers: Record<string, unknown>): string | undefined {
  const raw = headers['x-forwarded-for']
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const first = raw.split(',')[0]?.trim() ?? ''
  return first === '' ? undefined : first
}

/** 浏览器导航请求判定：GET + accept 含 text/html（需要返回登录页而非 403）。 */
export function isNavigationRequest(req: GateRequest): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const accept = req.headers.accept
  return typeof accept === 'string' && accept.includes('text/html')
}

/** 预解析白名单（含非法条目收集），每次判定复用。 */
export interface CompiledAllowlist {
  match: (ip: { value: bigint; bits: 32 | 128 }) => boolean
  invalid: string[]
}

export function compileAllowlist(entries: readonly string[]): CompiledAllowlist {
  const matchers = entries.flatMap((entry) => {
    const matcher = parseAllowEntry(entry)
    return matcher === null ? [] : [matcher]
  })
  const invalid = entries.filter((entry) => parseAllowEntry(entry) === null)
  return { match: (ip) => matchers.some((matcher) => matcher(ip)), invalid }
}

/**
 * 围栏判定（纯函数，除 token 哈希外无任何副作用与 IO）。
 * 逻辑次序：豁免路径由调用方前置处理；enabled=false 直通；确定有效来源
 * （受信 XFF 优先，否则 remoteAddress）；来源为 loopback 直连 → 放行；
 * 否则按白名单/token 判定；无来源 → fail-closed。
 *
 * loopback 语义：XFF 被信任时，存在 XFF 即代表请求经代理（serve→proxy→dsh
 * 全链 loopback，真实客户端只在 XFF 里）——remoteAddress 是 loopback 也不
 * 放行，必须按 XFF 判定；XFF 不被信任时，来源就是 remoteAddress，
 * loopback 即本机直连 → 放行（防锁死兜底优先）。
 */
export function decideGate(req: GateRequest, policy: GatePolicy): GateDecision {
  if (!policy.enabled) return { verdict: 'pass', reason: 'local' }

  const forwarded = forwardedIp(req.headers)
  const trustedForwarded = policy.trustForwardedFor ? forwarded : undefined
  const clientIpText = trustedForwarded ?? req.remoteAddress
  if (clientIpText === undefined) {
    return { verdict: 'block', reason: undefined }
  }
  if (trustedForwarded === undefined && isLoopbackAddress(req.remoteAddress)) {
    return { verdict: 'pass', reason: 'local' }
  }

  const allowlist = compileAllowlist(policy.allowedIps)
  const clientIp = parseIp(clientIpText)
  const allowedByIp = clientIp !== null && allowlist.match(clientIp)
  const cookieToken = readCookie(req.headers, GATE_COOKIE)
  const allowedByToken = cookieToken !== undefined && tokenMatches(cookieToken, policy.token)

  const decision: GateDecision = {
    verdict: allowedByIp || allowedByToken ? 'pass' : isNavigationRequest(req) ? 'login' : 'block',
    clientIp: clientIpText,
  }
  if (allowedByToken) decision.reason = 'token'
  else if (allowedByIp) decision.reason = 'allowed-ip'
  if (allowlist.invalid.length > 0) decision.invalidEntries = allowlist.invalid
  return decision
}
