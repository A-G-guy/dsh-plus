/**
 * routes.ts 单元测试：login 成功/失败/节流/cookie 属性、status 面。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'node:test'

import { type AccessGateConfig, Config } from '../src/config.ts'
import { createGateRoutes, createThrottleState } from '../src/routes.ts'

function fakeReq(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): IncomingMessage {
  const emitter = new EventEmitter()
  const req = emitter as unknown as IncomingMessage
  req.method = method
  req.url = `/dsh-plus/gate${path}`
  req.headers = {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers,
  }
  req.socket = { remoteAddress: '127.0.0.1' } as unknown as IncomingMessage['socket']
  queueMicrotask(() => {
    if (body !== undefined) emitter.emit('data', Buffer.from(JSON.stringify(body)))
    emitter.emit('end')
  })
  return req
}

interface Captured {
  status: number
  body: string
  headers: Record<string, string | string[]>
}

function fakeRes(): { res: ServerResponse; done: Promise<Captured> } {
  let status = 0
  const headers: Record<string, string | string[]> = {}
  let resolveDone!: (captured: Captured) => void
  const done = new Promise<Captured>((resolve) => {
    resolveDone = resolve
  })
  const res = {
    headersSent: false,
    writeHead(code: number, head?: Record<string, string | string[]>) {
      status = code
      if (head !== undefined) Object.assign(headers, head)
      this.headersSent = true
    },
    end(payload?: string) {
      resolveDone({ status, body: payload ?? '', headers })
    },
  } as unknown as ServerResponse
  return { res, done }
}

const DEFAULTS: AccessGateConfig = Config({})

test('login：正确 token → 200 + cookie 属性齐全', async () => {
  const handler = createGateRoutes({ config: () => ({ ...DEFAULTS, token: 'tok' }) })
  const { res, done } = fakeRes()
  await handler(fakeReq('POST', '/login', { token: 'tok' }), res)
  const captured = await done
  assert.equal(captured.status, 200)
  const cookie = captured.headers['set-cookie'] as string
  assert.ok(cookie.includes('dsh_gate=tok'))
  assert.ok(cookie.includes('HttpOnly'))
  assert.ok(cookie.includes('SameSite=Strict'))
  assert.ok(cookie.includes(`Max-Age=${720 * 3600}`))
})

test('login：错误 token → 403；达到阈值 → 429 冷却', async () => {
  const throttle = createThrottleState()
  let now = 1000
  const handler = createGateRoutes({
    config: () => ({ ...DEFAULTS, token: 'tok', loginFailLimit: 2, loginCooldownMs: 5000 }),
    throttle,
    clock: () => now,
    resolveClientIp: () => '8.8.8.8',
  })
  const first = fakeRes()
  await handler(fakeReq('POST', '/login', { token: 'wrong' }), first.res)
  assert.equal((await first.done).status, 403)
  const second = fakeRes()
  await handler(fakeReq('POST', '/login', { token: 'wrong' }), second.res)
  assert.equal((await second.done).status, 403)
  const third = fakeRes()
  await handler(fakeReq('POST', '/login', { token: 'tok' }), third.res)
  assert.equal((await third.done).status, 429, '达到阈值后正确 token 也进入冷却')
  now += 5001
  const fourth = fakeRes()
  await handler(fakeReq('POST', '/login', { token: 'tok' }), fourth.res)
  assert.equal((await fourth.done).status, 200, '冷却期满恢复')
})

test('login：非 JSON body / 缺 token 字段 → 400；方法错误 → 405', async () => {
  const handler = createGateRoutes({ config: () => DEFAULTS })
  const bad = fakeRes()
  await handler(fakeReq('POST', '/login', { other: 1 }), bad.res)
  assert.equal((await bad.done).status, 400)
  const wrongMethod = fakeRes()
  await handler(fakeReq('GET', '/login'), wrongMethod.res)
  assert.equal((await wrongMethod.done).status, 405)
})

test('login：成功后清除该 IP 失败计数', async () => {
  const throttle = createThrottleState()
  const handler = createGateRoutes({
    config: () => ({ ...DEFAULTS, token: 'tok', loginFailLimit: 2 }),
    throttle,
    resolveClientIp: () => '8.8.8.8',
  })
  const fail = fakeRes()
  await handler(fakeReq('POST', '/login', { token: 'wrong' }), fail.res)
  assert.equal((await fail.done).status, 403)
  const ok = fakeRes()
  await handler(fakeReq('POST', '/login', { token: 'tok' }), ok.res)
  assert.equal((await ok.done).status, 200)
  const failAgain = fakeRes()
  await handler(fakeReq('POST', '/login', { token: 'wrong' }), failAgain.res)
  assert.equal((await failAgain.done).status, 403, '计数已清零，单次失败不再触发冷却')
})

test('status：报告 enabled/verdict/clientIp/tokenConfigured', async () => {
  const handler = createGateRoutes({
    config: () => ({ ...DEFAULTS, enabled: true, allowedIps: ['8.8.8.8'] }),
    resolveClientIp: () => '8.8.8.8',
  })
  const { res, done } = fakeRes()
  await handler(fakeReq('GET', '/status', undefined, { 'x-forwarded-for': '8.8.8.8' }), res)
  const captured = await done
  assert.equal(captured.status, 200)
  const body = JSON.parse(captured.body) as Record<string, unknown>
  assert.equal(body.enabled, true)
  assert.equal(body.verdict, 'pass')
  assert.equal(body.reason, 'allowed-ip')
  assert.equal(body.allowedCount, 1)
})

test('未知端点 → 404', async () => {
  const handler = createGateRoutes({ config: () => DEFAULTS })
  const { res, done } = fakeRes()
  await handler(fakeReq('GET', '/unknown'), res)
  assert.equal((await done).status, 404)
})
