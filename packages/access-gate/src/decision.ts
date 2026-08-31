/**
 * 围栏判定核心：`decideGate` 纯函数。
 *
 * 信任模型（决策记录详见 docs/README.md）：
 * - dsh web 仅绑 127.0.0.1，远程流量必经 tailscale serve → dsh-proxy 两跳，
 *   serve 会**覆盖**（而非追加）x-forwarded-for，客户端无法伪造；
 * - 能直发 loopback 或伪造 XFF 的只有本机进程——本机直连视为可信管理通道；
 * - 因此 XFF 存在且 trustForwardedFor=true 时取最左条目为真实客户端 IP。
 *
 * 与官方认证合并后的判定语义：
 * - 访问凭据唯一化为官方 browser-auth cookie——`officialAuthed` 由调用方
 *   委托 `connection.requestRejection()` 得出，本模块不感知 cookie 细节；
 * - `allowedIps` 为可选附加围栏：非空时来源 IP 不命中即拒（纵深防御），
 *   空则不限制来源 IP（仅官方登录保护）；
 * - 未认证的浏览器导航 → token 输入页（粘贴启动令牌走官方交换，PWA 同路径）；
 *   未认证的非导航请求 → 403。
 * @module access-gate/decision
 */
import type { GatePolicy } from './config.ts'
import { isLoopbackAddress, parseAllowEntry, parseIp } from './ip.ts'

/** 围栏判定结果。 */
export type GateVerdict =
  | 'pass' /** 放行（本机直连 / 官方 cookie 有效） */
  | 'block' /** 拒绝：非导航请求或 IP 围栏拦截 → 403 */
  | 'token-page' /** 拒绝：浏览器导航请求 → token 输入页 */

/** 判定输出。 */
export interface GateDecision {
  verdict: GateVerdict
  /** 还原出的客户端 IP（有 XFF 或非 loopback 直连时存在）。 */
  clientIp?: string
  /** 放行原因（诊断/日志用）：local / cookie。 */
  reason?: 'local' | 'cookie'
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

/** 取 XFF 最左条目（serve 单跳覆盖语义下即真实客户端 IP）。 */
function forwardedIp(headers: Record<string, unknown>): string | undefined {
  const raw = headers['x-forwarded-for']
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const first = raw.split(',')[0]?.trim() ?? ''
  return first === '' ? undefined : first
}

/** 浏览器导航请求判定：GET + accept 含 text/html（需要返回 token 输入页而非 403）。 */
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
 * 围栏判定（纯函数，无任何副作用与 IO）。
 * 逻辑次序：豁免路径由调用方前置处理；enabled=false 直通；确定有效来源
 * （受信 XFF 优先，否则 remoteAddress）；来源为 loopback 直连 → 放行；
 * 白名单非空时作附加 IP 围栏，不命中即拒；官方 cookie 有效 → 放行；
 * 否则导航 → token 输入页，非导航 → 403；无来源 → fail-closed。
 *
 * loopback 语义：XFF 被信任时，存在 XFF 即代表请求经代理（serve→proxy→dsh
 * 全链 loopback，真实客户端只在 XFF 里）——remoteAddress 是 loopback 也不
 * 放行，必须按 XFF 判定；XFF 不被信任时，来源就是 remoteAddress，
 * loopback 即本机直连 → 放行（防锁死兜底优先）。
 *
 * @param officialAuthed - 官方 browser-auth cookie 校验结果（调用方委托
 *   connection.requestRejection() 得出；含官方 Host 信任围栏，403 情形
 *   视同未认证）。
 */
export function decideGate(
  req: GateRequest,
  policy: GatePolicy,
  officialAuthed: boolean,
): GateDecision {
  if (!policy.enabled) return { verdict: 'pass', reason: 'local' }

  const forwarded = forwardedIp(req.headers)
  const trustedForwarded = policy.trustForwardedFor ? forwarded : undefined
  const clientIpText = trustedForwarded ?? req.remoteAddress
  if (clientIpText === undefined) {
    return { verdict: 'block' }
  }
  if (trustedForwarded === undefined && isLoopbackAddress(req.remoteAddress)) {
    return { verdict: 'pass', reason: 'local' }
  }

  const allowlist = compileAllowlist(policy.allowedIps)
  const invalidEntries = allowlist.invalid.length > 0 ? allowlist.invalid : undefined

  // 附加 IP 围栏：白名单非空时，来源不命中即拒（含持有效官方 cookie 者）。
  if (policy.allowedIps.length > 0) {
    const clientIp = parseIp(clientIpText)
    if (clientIp === null || !allowlist.match(clientIp)) {
      return { verdict: 'block', clientIp: clientIpText, invalidEntries }
    }
  }

  if (officialAuthed) {
    return { verdict: 'pass', reason: 'cookie', clientIp: clientIpText, invalidEntries }
  }
  return {
    verdict: isNavigationRequest(req) ? 'token-page' : 'block',
    clientIp: clientIpText,
    invalidEntries,
  }
}
