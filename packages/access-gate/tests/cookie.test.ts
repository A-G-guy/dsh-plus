/**
 * cookie.ts 单元测试：官方 browser-auth cookie 铸造面（IP 信任自动登录核心）。
 * 契约对齐 dsh 0.1.2-alpha.2 client-connection browser-auth（逐行核实）：
 * cookie 名 = dsh-auth-<b64url(sha256(authority))>；值 = v1.<b64url(payload)>.<b64url(hmac)>；
 * payload 键序 {"version":1,"authority","issuedAt","expiresAt"}（紧凑 JSON）；
 * 属性 Max-Age/Expires/Path=/HttpOnly/SameSite=Strict；服务端校验时长 <= 30 天。
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  COOKIE_MAX_AGE_MS,
  COOKIE_PREFIX,
  cookieName,
  credentialsPath,
  decodeCookiePayload,
  isAuthenticatedCookie,
  mintAutoLoginCookie,
  mintSessionCookie,
  readSigningSecretFromFile,
  requestAuthority,
  serializeSessionCookie,
} from '../src/cookie.ts'

const SECRET = Buffer.alloc(32, 7)
const AUTHORITY = '127.0.0.1:3080'
const NOW = 1_788_000_000_000

function b64url(data: Buffer): string {
  return data.toString('base64url')
}

/** 按官方 encodeCookie 键序手工构造 cookie 值（对拍基准）。 */
function officialValue(authority: string, issuedAt: number, expiresAt: number): string {
  const body = b64url(
    Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8'),
  )
  const sig = createHmac('sha256', SECRET).update(body).digest()
  return `v1.${body}.${b64url(sig)}`
}

function writeCredentials(dir: string, secretB64: string): string {
  const path = join(dir, '.credentials.yaml')
  writeFileSync(
    path,
    `version: 1\nrefs:\n  FOO: bar\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      version: 1\n      secret: ${secretB64}\n`,
  )
  return path
}

test('requestAuthority：Host 归一化（host:port，与官方同实现）', () => {
  assert.equal(
    requestAuthority({ host: 'miniserver.tail27b689.ts.net:3080' }),
    'miniserver.tail27b689.ts.net:3080',
  )
  assert.equal(requestAuthority({ host: '127.0.0.1:3080' }), '127.0.0.1:3080')
  assert.equal(requestAuthority({ host: 'Example.COM' }), 'example.com')
  assert.equal(requestAuthority({}), undefined)
  assert.equal(requestAuthority({ host: '' }), undefined)
})

test('cookieName：官方同款 dsh-auth-<b64url(sha256(authority))>', () => {
  assert.equal(
    cookieName(AUTHORITY),
    COOKIE_PREFIX + b64url(createHash('sha256').update(AUTHORITY).digest()),
  )
  assert.match(cookieName('x:1'), /^dsh-auth-[A-Za-z0-9_-]{43}$/)
})

test('mintSessionCookie：值结构与官方 ?token= 交换产物逐字节等价', () => {
  const cookie = mintSessionCookie(SECRET, AUTHORITY, NOW)
  const [attrs, value] = splitCookie(cookie)
  assert.equal(value, officialValue(AUTHORITY, NOW, NOW + COOKIE_MAX_AGE_MS))
  assert.match(attrs, new RegExp(`^${cookieName(AUTHORITY)}=`))
  assert.match(cookie, /; Path=\/;/)
  assert.match(cookie, /; Max-Age=\d+;/)
  assert.match(cookie, /; HttpOnly; SameSite=Strict$/)
})

test('serializeSessionCookie：Max-Age/Expires 与官方 sessionCookie 同构', () => {
  const header = serializeSessionCookie('name', 'value', NOW + 60_000, NOW)
  assert.equal(
    header,
    `name=value; Max-Age=60; Path=/; Expires=${new Date(NOW + 60_000).toUTCString()}; HttpOnly; SameSite=Strict`,
  )
})

test('decodeCookiePayload：官方铸造的 cookie 可验签解出', () => {
  const value = officialValue(AUTHORITY, NOW - 1000, NOW + COOKIE_MAX_AGE_MS - 1000)
  const payload = decodeCookiePayload(value, SECRET)
  assert.deepEqual(payload, {
    authority: AUTHORITY,
    issuedAt: NOW - 1000,
    expiresAt: NOW + COOKIE_MAX_AGE_MS - 1000,
  })
})

test('decodeCookiePayload：签名不符/字段损坏/过期/超时长 → null（与官方校验一致）', () => {
  const valid = officialValue(AUTHORITY, NOW, NOW + COOKIE_MAX_AGE_MS)
  assert.equal(
    decodeCookiePayload(valid.replace(/.$/, valid.slice(-1) === 'A' ? 'B' : 'A'), SECRET),
    null,
    '签名破坏',
  )
  assert.equal(decodeCookiePayload('v1.xxx.yyy', SECRET), null)
  // 过期
  assert.equal(
    decodeCookiePayload(officialValue(AUTHORITY, NOW - COOKIE_MAX_AGE_MS - 1, NOW - 1), SECRET),
    null,
  )
  // 时长超上限（官方 expiresAt-issuedAt <= cookieMaxAgeDays）
  assert.equal(
    decodeCookiePayload(officialValue(AUTHORITY, NOW, NOW + COOKIE_MAX_AGE_MS + 1), SECRET),
    null,
  )
})

test('isAuthenticatedCookie：名与 authority 双绑定，语义等价官方 isAuthenticated', () => {
  const other = 'miniserver.tail27b689.ts.net:3080'
  const header = `${cookieName(AUTHORITY)}=${officialValue(AUTHORITY, NOW, NOW + COOKIE_MAX_AGE_MS)}`
  assert.ok(isAuthenticatedCookie(header, AUTHORITY, SECRET))
  assert.equal(isAuthenticatedCookie(header, other, SECRET), false, 'authority 不匹配')
  assert.equal(isAuthenticatedCookie(undefined, AUTHORITY, SECRET), false)
  assert.equal(isAuthenticatedCookie('other=zzz', AUTHORITY, SECRET), false)
  const broken = `${cookieName(AUTHORITY)}=v1.bad.sig`
  assert.equal(isAuthenticatedCookie(broken, AUTHORITY, SECRET), false)
})

test('readSigningSecretFromFile：正常提取（dshctl auth.py 同款解析）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-cookie-'))
  const path = writeCredentials(dir, b64url(SECRET))
  assert.deepEqual(readSigningSecretFromFile(path), SECRET)
})

test('readSigningSecretFromFile：缺文件/缺段/长度不符 → 明确错误', () => {
  assert.throws(
    () => readSigningSecretFromFile(join(tmpdir(), 'gate-none', '.credentials.yaml')),
    /read \.credentials\.yaml failed/,
  )
  const dir = mkdtempSync(join(tmpdir(), 'gate-cookie-'))
  const empty = join(dir, 'empty.yaml')
  writeFileSync(empty, 'version: 1\nrecords: {}\n')
  assert.throws(() => readSigningSecretFromFile(empty), /secret not found/)
  const short = writeCredentials(dir, b64url(Buffer.alloc(16, 1)))
  assert.throws(() => readSigningSecretFromFile(short), /invalid length/)
})

test('mintAutoLoginCookie：端到端（读密钥 → 铸造）与手工官方构造一致', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-cookie-'))
  const path = writeCredentials(dir, b64url(SECRET))
  const cookie = mintAutoLoginCookie(path, AUTHORITY, NOW)
  const [, value] = splitCookie(cookie)
  assert.equal(value, officialValue(AUTHORITY, NOW, NOW + COOKIE_MAX_AGE_MS))
  // 铸出的 cookie 能通过自身校验闭环
  const header = `${cookieName(AUTHORITY)}=${value}`
  assert.ok(isAuthenticatedCookie(header, AUTHORITY, SECRET))
})

test('credentialsPath：DSH_HOME 下凭据文件拼接', () => {
  assert.equal(credentialsPath('/home/u/.dsh'), '/home/u/.dsh/.credentials.yaml')
})

function splitCookie(cookie: string): [attrs: string, value: string] {
  const eq = cookie.indexOf('=')
  const sp = cookie.indexOf(';')
  const name = cookie.slice(0, eq)
  assert.match(name, /^dsh-auth-/)
  const value = cookie.slice(eq + 1, sp)
  return [cookie.slice(0, sp), value]
}
