/**
 * decision.ts 单元测试：合并官方认证后的围栏判定全部规则分支。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GatePolicy } from '../src/config.ts'
import { compileAllowlist, decideGate, isNavigationRequest } from '../src/decision.ts'
import { parseIp as parseIpOf } from '../src/ip.ts'

const BASE: GatePolicy = {
  enabled: true,
  allowedIps: [],
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

function navReq(headers: Record<string, string>): Parameters<typeof decideGate>[0] {
  return req({
    method: 'GET',
    url: '/',
    headers: { ...headers, accept: 'text/html,application/xhtml+xml' },
  })
}

test('enabled=false：完全旁路', () => {
  const decision = decideGate(
    req({ headers: { 'x-forwarded-for': '8.8.8.8' } }),
    {
      ...BASE,
      enabled: false,
    },
    false,
  )
  assert.equal(decision.verdict, 'pass')
})

test('本机直连（loopback 且无 XFF）：永久放行', () => {
  const decision = decideGate(req(), BASE, false)
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.reason, 'local')
})

test('本机直连但带 XFF：视为远程（代理链上的请求）', () => {
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), BASE, true)
  assert.equal(decision.clientIp, '8.8.8.8')
  // 官方 cookie 有效才放行；XFF 存在即不享 loopback 直通
  assert.equal(decision.reason, 'cookie')
})

test('远程 + 官方 cookie 有效：放行（reason=cookie）', () => {
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), BASE, true)
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.reason, 'cookie')
})

test('远程 + 官方 cookie 无效：API 请求 block，浏览器导航 token-page', () => {
  const api = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), BASE, false)
  assert.equal(api.verdict, 'block')
  const nav = decideGate(navReq({ 'x-forwarded-for': '8.8.8.8' }), BASE, false)
  assert.equal(nav.verdict, 'token-page')
})

test('附加 IP 围栏：白名单命中但无官方 cookie → 不放行（给登录入口）', () => {
  const policy: GatePolicy = { ...BASE, allowedIps: ['100.108.58.63'] }
  const nav = decideGate(navReq({ 'x-forwarded-for': '100.108.58.63' }), policy, false)
  assert.equal(nav.verdict, 'token-page')
  const api = decideGate(req({ headers: { 'x-forwarded-for': '100.108.58.63' } }), policy, false)
  assert.equal(api.verdict, 'block')
})

test('附加 IP 围栏：白名单不命中即使持有效官方 cookie 也拒绝', () => {
  const policy: GatePolicy = { ...BASE, allowedIps: ['100.108.58.63'] }
  const decision = decideGate(req({ headers: { 'x-forwarded-for': '8.8.8.8' } }), policy, true)
  assert.equal(decision.verdict, 'block')
  assert.equal(decision.clientIp, '8.8.8.8')
})

test('附加 IP 围栏：白名单命中且官方 cookie 有效 → 放行', () => {
  const policy: GatePolicy = { ...BASE, allowedIps: ['100.108.58.63'] }
  const decision = decideGate(
    req({ headers: { 'x-forwarded-for': '100.108.58.63' } }),
    policy,
    true,
  )
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.reason, 'cookie')
})

test('XFF 取最左条目（代理链追加语义不干扰）', () => {
  const policy: GatePolicy = { ...BASE, allowedIps: ['100.108.58.63'] }
  const decision = decideGate(
    req({ headers: { 'x-forwarded-for': '100.108.58.63, 10.0.0.1' } }),
    policy,
    true,
  )
  assert.equal(decision.verdict, 'pass')
  assert.equal(decision.clientIp, '100.108.58.63')
})

test('trustForwardedFor=false：XFF 忽略，loopback 直连仍放行（防锁死兜底优先）', () => {
  // XFF 不被信任 → 请求的来源就是 remoteAddress（loopback）→ 本机直连放行。
  // 若此时不放行，唯一入口是代理的部署（serve→proxy→dsh 全链 loopback）
  // 会在关闭 XFF 信任的瞬间锁死全部远程访问。
  const local = decideGate(
    req({ headers: { 'x-forwarded-for': '8.8.8.8' } }),
    {
      ...BASE,
      trustForwardedFor: false,
    },
    false,
  )
  assert.equal(local.verdict, 'pass')
  assert.equal(local.reason, 'local')
})

test('trustForwardedFor=false + 非 loopback 直连：按直连 IP 走白名单', () => {
  const policy: GatePolicy = { ...BASE, allowedIps: ['100.108.58.63'], trustForwardedFor: false }
  const blocked = decideGate(
    req({ remoteAddress: '8.8.8.8', headers: { 'x-forwarded-for': '100.108.58.63' } }),
    policy,
    true,
  )
  assert.equal(blocked.verdict, 'block', 'XFF 不可信时不许借道白名单')
  const allowed = decideGate(req({ remoteAddress: '100.108.58.63' }), policy, true)
  assert.equal(allowed.verdict, 'pass')
})

test('无来源（无 XFF 且无 remoteAddress）：fail-closed', () => {
  const decision = decideGate(req({ remoteAddress: undefined }), BASE, true)
  assert.equal(decision.verdict, 'block')
})

test('非法白名单条目被忽略并上报 invalidEntries', () => {
  const decision = decideGate(
    req({ headers: { 'x-forwarded-for': '8.8.8.8' } }),
    {
      ...BASE,
      allowedIps: ['garbage', '100.108.58.63'],
    },
    true,
  )
  assert.equal(decision.verdict, 'block')
  assert.deepEqual(decision.invalidEntries, ['garbage'])
})

test('导航判定：GET + accept 含 text/html；POST / API 不算导航', () => {
  assert.ok(isNavigationRequest(req({ method: 'GET', headers: { accept: 'text/html' } })))
  assert.ok(!isNavigationRequest(req({ method: 'POST', headers: { accept: 'text/html' } })))
  assert.ok(!isNavigationRequest(req({ method: 'GET', headers: { accept: 'application/json' } })))
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
