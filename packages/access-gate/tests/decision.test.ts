/**
 * decision.ts 单元测试：围栏判定的全部规则分支。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GatePolicy } from '../src/config.ts'
import { compileAllowlist, decideGate, isNavigationRequest, readCookie } from '../src/decision.ts'

const BASE: GatePolicy = {
  enabled: true,
  token: 'secret-token',
  allowedIps: ['100.108.58.63'],
  trustForwardedFor: true,
}

function req(
  overrides: Partial<Parameters<typeof decideGate>[0]> = {},
): Parameters<typeof decideGate>[0] {
  return {
    url: '/api/x',
    method: 'POST',
    headers: {},
    remoteAddress: '127.0.0.1',
    ...overrides,
  }
}

test('enabled=false：完全旁路', () => {
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), {
    ...BASE,
    enabled: false,
  })
  assert.equal(decision.verdict, 'pass')
})

test('本机直连（loopback 且无 XFF）：永久放行', () => {
  const decision = decideGate(req(), BASE)
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.reason, 'local')
})

test('本机直连但带 XFF：视为远程（代理链上的请求）', () => {
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), BASE)
  assert.notEqual(decision.verdict, 'pass')
  assert.equal(decision.clientIp, '8.8.8.8')
})

test('XFF 白名单 IP：放行', () => {
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '100.108.58.63' } }), BASE)
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.reason, 'allowed-ip')
})

test('XFF 取最左条目（代理链追加语义不干扰）', () => {
  const decision = decideGate(
    req({ headers: { 'x-forwarded-for': '100.108.58.63, 10.0.0.1' } }),
    BASE,
  )
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.clientIp, '100.108.58.63')
})

test('XFF 陌生 IP：API 请求 403（block）', () => {
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), BASE)
  assert.equal(decision.verdict, 'block')
})

test('XFF 陌生 IP + 浏览器导航：login（返回登录页）', () => {
  const decision = decideGate(
    req({
      method: 'GET',
      url: '/',
      headers: { 'x-forwarded-for': '8.8.8.8', accept: 'text/html,application/xhtml+xml' },
    }),
    BASE,
  )
  assert.equal(decision.verdict, 'login')
})

test('有效 token cookie：放行', () => {
  const decision = decideGate(
    req({ headers: { 'x-forwarded-for': '8.8.8.8', cookie: 'dsh_gate=secret-token' } }),
    BASE,
  )
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.reason, 'token')
})

test('错误 token cookie：仍拦截', () => {
  const decision = decideGate(
    req({ headers: { 'x-forwarded-for': '8.8.8.8', cookie: 'dsh_gate=wrong' } }),
    BASE,
  )
  assert.equal(decision.verdict, 'block')
})

test('token 通道关闭（空 token）：cookie 也不放行', () => {
  const decision = decideGate(
    req({ headers: { 'x-forwarded-for': '8.8.8.8', cookie: 'dsh_gate=' } }),
    { ...BASE, token: '' },
  )
  assert.equal(decision.verdict, 'block')
})

test('trustForwardedFor=false：XFF 忽略，loopback 直连仍放行（防锁死兜底优先）', () => {
  // XFF 不被信任 → 请求的来源就是 remoteAddress（loopback）→ 本机直连放行。
  // 若此时不放行，唯一入口是代理的部署（serve→proxy→dsh 全链 loopback）
  // 会在关闭 XFF 信任的瞬间锁死全部远程访问。
  const local = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), {
    ...BASE,
    trustForwardedFor: false,
  })
  assert.equal(local.verdict, 'pass')
  assert.equal(local.reason, 'local')
})

test('trustForwardedFor=true：loopback remoteAddress + XFF 视为远程（生产链路常态）', () => {
  // serve→proxy→dsh 全链 loopback，真实客户端只在 XFF 里：
  // 围栏必须按 XFF 判定，绝不能因 remoteAddress 是 loopback 而放行。
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), BASE)
  assert.equal(decision.verdict, 'block')
  assert.equal(decision.clientIp, '8.8.8.8')
})

test('trustForwardedFor=false + 非 loopback 直连：按直连 IP 走白名单', () => {
  const decision = decideGate(
    req({ remoteAddress: '100.108.58.63', headers: { 'x-forwarded-for': '8.8.8.8' } }),
    { ...BASE, trustForwardedFor: false },
  )
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.reason, 'allowed-ip')
})

test('fail-closed：enabled 且无 token 且白名单空 → 远程全拒', () => {
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '100.108.58.63' } }), {
    ...BASE,
    token: '',
    allowedIps: [],
  })
  assert.equal(decision.verdict, 'block')
})

test('非法白名单条目被忽略并上报 invalidEntries', () => {
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), {
    ...BASE,
    allowedIps: ['garbage', '100.108.58.63'],
  })
  assert.equal(decision.verdict, 'block')
  assert.deepEqual(decision.invalidEntries, ['garbage'])
})

test('导航判定：GET + accept 含 text/html；POST / API 不算导航', () => {
  assert.ok(isNavigationRequest(req({ method: 'GET', headers: { accept: 'text/html' } })))
  assert.ok(!isNavigationRequest(req({ method: 'POST', headers: { accept: 'text/html' } })))
  assert.ok(!isNavigationRequest(req({ method: 'GET', headers: { accept: 'application/json' } })))
})

test('cookie 解析：多 cookie、空值、缺名', () => {
  const headers = { cookie: 'a=1; dsh_gate=tok; b=2' }
  assert.equal(readCookie(headers, 'dsh_gate'), 'tok')
  assert.equal(readCookie(headers, 'missing'), undefined)
  assert.equal(readCookie({ cookie: 'dsh_gate=; a=1' }, 'dsh_gate'), undefined)
  assert.equal(readCookie({}, 'dsh_gate'), undefined)
})

test('compileAllowlist：v4+v6 混合判定与非法收集', () => {
  const list = compileAllowlist(['100.108.58.63', 'fd7a:115c:a1e0::/48', 'bad'])
  assert.ok(list.match(parseIpLike('100.108.58.63')))
  assert.ok(list.match(parseIpLike('fd7a:115c:a1e0::1')))
  assert.ok(!list.match(parseIpLike('8.8.8.8')))
  assert.deepEqual(list.invalid, ['bad'])
})

function parseIpLike(text: string): { value: bigint; bits: 32 | 128 } {
  const parsed = parseIpOf(text)
  assert.ok(parsed !== null)
  return parsed
}

import { parseIp as parseIpOf } from '../src/ip.ts'
