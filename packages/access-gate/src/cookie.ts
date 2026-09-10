/**
 * 官方 browser-auth cookie 铸造（IP 信任自动登录的核心纯函数面）。
 *
 * 目标：对「IP 信任白名单来源」的未认证请求，在服务端自签与官方
 * `?token=` 启动令牌交换产物等价的 `dsh-auth-*` cookie——写进响应后
 * 浏览器落罐，后续 /api、WS 的官方 requestRejection() 自然通过，
 * 用户全程无感、免启动 token。
 *
 * 契约（对 dsh 0.1.2-alpha.2 / 0.1.3-alpha.2 官方 client-connection
 * browser-auth 逐行核实，见 docs/README.md「信任模型」）：
 * - 签名密钥持久化于 $DSH_HOME/.credentials.yaml
 *   （records → client-connection/browser-session → payload.secret，
 *   base64url 无填充 32B；跨重启不变）；
 * - cookie 名 = `dsh-auth-<base64url(sha256(authority))>`，
 *   authority = 请求 Host 经 `new URL('http://'+host).host` 归一化
 *   （host:port，含端口；与官方 requestAuthority() 同实现）；
 * - cookie 值 = `v1.<base64url(payload-json)>.<base64url(hmac-sha256(secret, body))>`，
 *   payload 键序固定 {"version":1,"authority":…,"issuedAt":ms,"expiresAt":ms}，
 *   JSON.stringify 紧凑序列化；
 * - 属性与官方 sessionCookie() 同款：Max-Age/Expires/Path=HttpOnly/SameSite=Strict；
 * - 服务端校验 `expiresAt - issuedAt <= cookieMaxAgeDays`（默认 30 天）且
 *   下界 1 天；本模块取官方默认 30 天。
 *
 * 本模块不 import 官方包：密钥从文件读取（dshctl auth.py 同款定向文本
 * 解析），crypto 用 node: 内置。全部为纯函数/可注入，测试零网络零依赖。
 * 安全：任何解析失败都返回明确错误（fail-loud / fail-safe），绝不产出
 * 半成品 cookie。
 * @module access-gate/cookie
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 官方 cookie 名前缀（client-connection browser-auth 常量）。 */
export const COOKIE_PREFIX = 'dsh-auth-'
/** payload version（官方 COOKIE_PAYLOAD_VERSION）。 */
const PAYLOAD_VERSION = 1
/** 密钥长度（官方 SECRET_BYTES）。 */
const SECRET_BYTES = 32
/** 自签 cookie 有效期：官方默认 cookieMaxAgeDays。 */
export const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** .credentials.yaml 中 browser-session 段名（AUTH_RECORD_KEY 的 id）。 */
const SECRET_SECTION = 'client-connection/browser-session'
/** payload 键序（官方 encodeCookie 的 JSON.stringify 紧凑序列化键序）。 */
const PAYLOAD_KEYS = ['version', 'authority', 'issuedAt', 'expiresAt'] as const

function base64url(data: Buffer): string {
  return data.toString('base64url')
}

/** 取请求 authority（官方 requestAuthority 同款：Host → URL.host，host:port）。 */
export function requestAuthority(headers: { host?: unknown }): string | undefined {
  const host = headers.host
  if (typeof host !== 'string' || host === '') return undefined
  try {
    return new URL(`http://${host}`).host
  } catch {
    return undefined
  }
}

/** 官方 cookie 名（authority 绑定，同 requestAuthority 输出）。 */
export function cookieName(authority: string): string {
  return COOKIE_PREFIX + base64url(createHash('sha256').update(authority).digest())
}

/** 校验签名（官方 isAuthenticated/decodeCookie 同款防时序侧信道比较）。 */
function validSignature(value: string, secret: Buffer): boolean {
  const [version, body, encodedSignature] = value.split('.')
  if (version !== 'v1' || body === undefined || encodedSignature === undefined) return false
  const actual = Buffer.from(encodedSignature, 'base64url')
  if (actual.byteLength === 0) return false
  const expected = createHmac('sha256', secret).update(body).digest()
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

/** cookie 载荷的三字段（官方 encodeCookie 的键集；version 由形状守卫单判）。 */
interface CookiePayload {
  authority: string
  issuedAt: number
  expiresAt: number
}

/**
 * 载荷形状守卫（类型谓词）：version 必须等于 PAYLOAD_VERSION，三字段类型正确。
 * 逐字段 `in` + typeof 收窄取代裸断言——JSON.parse 回来的是 unknown，
 * 只有守卫通过后才允许按 CookiePayload 访问。
 */
function isCookiePayload(value: unknown): value is CookiePayload {
  if (typeof value !== 'object' || value === null) return false
  if (!('version' in value) || value.version !== PAYLOAD_VERSION) return false
  if (!('authority' in value) || typeof value.authority !== 'string') return false
  if (!('issuedAt' in value) || typeof value.issuedAt !== 'number') return false
  if (!('expiresAt' in value) || typeof value.expiresAt !== 'number') return false
  return Number.isSafeInteger(value.issuedAt) && Number.isSafeInteger(value.expiresAt)
}

/** 解码 cookie 载荷（返回 null = 值损坏/签名不符/字段缺失，语义与官方一致）。 */
export function decodeCookiePayload(value: string, secret: Buffer): CookiePayload | null {
  if (!validSignature(value, secret)) return null
  const body = value.split('.')[1]
  if (body === undefined) return null
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!isCookiePayload(decoded)) return null
  const { authority, issuedAt, expiresAt } = decoded
  const now = Date.now()
  if (issuedAt > now || expiresAt <= now || expiresAt <= issuedAt) return null
  if (expiresAt - issuedAt > COOKIE_MAX_AGE_MS) return null
  return { authority, issuedAt, expiresAt }
}

/**
 * 校验既有 cookie 是否（对给定 authority）有效——等价官方
 * `browserAuth.isAuthenticated`（无 authority 匹配即 false）。
 */
export function isAuthenticatedCookie(
  cookieHeader: string | undefined,
  authority: string,
  secret: Buffer,
): boolean {
  if (cookieHeader === undefined) return false
  const name = cookieName(authority)
  for (const segment of cookieHeader.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    const payload = decodeCookiePayload(segment.slice(at + 1).trim(), secret)
    if (payload === null) return false
    return payload.authority === authority
  }
  return false
}

/** 定向解析 .credentials.yaml 中 browser-session 段（dshctl auth.py 同款）。 */
export function readSigningSecretFromFile(credentialsYamlPath: string): Buffer {
  let text: string
  try {
    text = readFileSync(credentialsYamlPath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`read .credentials.yaml failed (${credentialsYamlPath}): ${detail}`)
  }
  let inSection = false
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim()
    if (stripped === '' || stripped.startsWith('#')) continue
    const indent = line.length - line.replace(/^\s*/, '').length
    if (indent <= 2) {
      inSection = stripped === `${SECRET_SECTION}:`
      continue
    }
    if (inSection) {
      const match = /^secret:\s*(\S+)\s*$/.exec(stripped)
      if (match !== null) {
        const secret = Buffer.from(match[1] ?? '', 'base64url')
        if (secret.byteLength !== SECRET_BYTES) {
          throw new Error(
            `browser-session secret has invalid length (${secret.byteLength}, want ${SECRET_BYTES})`,
          )
        }
        return secret
      }
    }
  }
  throw new Error(`browser-session secret not found in ${credentialsYamlPath}`)
}

/** 官方 sessionCookie() 序列化（属性逐字同款；nowMs 注入保持纯函数可测）。 */
export function serializeSessionCookie(
  name: string,
  value: string,
  expiresAt: number,
  nowMs: number,
): string {
  const maxAgeSeconds = Math.floor((expiresAt - nowMs) / 1000)
  return (
    `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; ` +
    `Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
  )
}

/** 铸造官方同款 cookie（键序/序列化/属性全对齐），返回可直接写 Set-Cookie 的串。 */
export function mintSessionCookie(secret: Buffer, authority: string, nowMs: number): string {
  const expiresAt = nowMs + COOKIE_MAX_AGE_MS
  const payload: Record<string, unknown> = { version: PAYLOAD_VERSION }
  for (const key of PAYLOAD_KEYS) {
    if (key === 'version') continue
    payload[key] = key === 'authority' ? authority : key === 'issuedAt' ? nowMs : expiresAt
  }
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = base64url(createHmac('sha256', secret).update(body).digest())
  return serializeSessionCookie(cookieName(authority), `v1.${body}.${signature}`, expiresAt, nowMs)
}

/** 拼接 DSH_HOME 下凭据文件路径（默认 home 与 $DSH_HOME 语义同官方 home-paths）。 */
export function credentialsPath(dshHome: string): string {
  return join(dshHome, '.credentials.yaml')
}

/** 完整铸造入口：读密钥 + 铸造；任何失败抛带上下文错误（调用方降级 fail-safe）。 */
export function mintAutoLoginCookie(
  credentialsYamlPath: string,
  authority: string,
  nowMs: number,
): string {
  const secret = readSigningSecretFromFile(credentialsYamlPath)
  return mintSessionCookie(secret, authority, nowMs)
}
