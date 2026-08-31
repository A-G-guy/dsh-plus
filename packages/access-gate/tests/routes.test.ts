/**
 * routes.ts 单元测试：status 判定面与 launch-url 管理通道（loopback 限定）。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'node:test'

import { type AccessGateConfig, Config } from '../src/config.ts'
import { createGateRoutes, type RouteDeps } from '../src/routes.ts'

function fakeReq(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  remoteAddress = '127.0.0.1',
): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage
  req.method = method
  req.url = `/dsh-plus/gate${path}`
  req.headers = headers
  req.socket = { remoteAddress } as unknown as IncomingMessage['socket']
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

function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    config: () => DEFAULTS,
    officialAuth: () => false,
    authenticatedUrl: (base) => `${base}/?token=process-token`,
    ...overrides,
  }
}

test('status：报告 enabled/verdict/officialAuthed/ipFenceActive', async () => {
  const handler = createGateRoutes(
    makeDeps({
      config: () => Config({ enabled: true, allowedIps: ['100.108.58.63'] }),
      officialAuth: () => true,
    }),
  )
  const { res, done } = fakeRes()
  await handler(fakeReq('GET', '/status', { 'x-forwarded-for': '100.108.58.63' }), res)
  const captured = await done
  assert.equal(captured.status, 200)
  const body = JSON.parse(captured.body) as Record<string, unknown>
  assert.equal(body.enabled, true)
  assert.equal(body.verdict, 'pass')
  assert.equal(body.reason, 'cookie')
  assert.equal(body.officialAuthed, true)
  assert.equal(body.ipFenceActive, true)
  assert.equal(body.allowedCount, 1)
  assert.equal(body.clientIp, '100.108.58.63')
})

test('status：远程未认证的导航请求 → verdict=token-page', async () => {
  const handler = createGateRoutes(
    makeDeps({
      config: () => Config({ enabled: true }),
    }),
  )
  const { res, done } = fakeRes()
  await handler(
    fakeReq('GET', '/status', { 'x-forwarded-for': '8.8.8.8', accept: 'text/html' }),
    res,
  )
  const body = JSON.parse((await done).body) as Record<string, unknown>
  assert.equal(body.verdict, 'token-page')
  assert.equal(body.officialAuthed, false)
  assert.equal(body.ipFenceActive, false)
})

test('launch-url：本机直连返回当前进程认证链接', async () => {
  const handler = createGateRoutes(makeDeps())
  const { res, done } = fakeRes()
  await handler(fakeReq('GET', '/launch-url', { host: '127.0.0.1:3080' }), res)
  const captured = await done
  assert.equal(captured.status, 200)
  const body = JSON.parse(captured.body) as Record<string, unknown>
  assert.equal(body.url, 'http://127.0.0.1:3080/?token=process-token')
})

test('launch-url：host/scheme 参数生成远程 authority 变体', async () => {
  const handler = createGateRoutes(makeDeps())
  const { res, done } = fakeRes()
  await handler(
    fakeReq('GET', '/launch-url?host=miniserver.example.ts.net:3080&scheme=https', {
      host: '127.0.0.1:3080',
    }),
    res,
  )
  const body = JSON.parse((await done).body) as Record<string, unknown>
  assert.equal(body.url, 'https://miniserver.example.ts.net:3080/?token=process-token')
})

test('launch-url：带 XFF（经代理的远程请求）→ 403；非 loopback socket → 403', async () => {
  const handler = createGateRoutes(makeDeps())
  const proxied = fakeRes()
  await handler(
    fakeReq('GET', '/launch-url', { host: '127.0.0.1:3080', 'x-forwarded-for': '8.8.8.8' }),
    proxied.res,
  )
  assert.equal((await proxied.done).status, 403)
  const remote = fakeRes()
  await handler(fakeReq('GET', '/launch-url', { host: 'x' }, '100.108.58.63'), remote.res)
  assert.equal((await remote.done).status, 403)
})

test('launch-url：非法 host 参数 → 400；方法错误 → 405', async () => {
  const handler = createGateRoutes(
    makeDeps({
      authenticatedUrl: () => {
        throw new Error('Invalid URL')
      },
    }),
  )
  const bad = fakeRes()
  await handler(fakeReq('GET', '/launch-url?host=%', { host: '127.0.0.1:3080' }), bad.res)
  assert.equal((await bad.done).status, 400)
  const wrongMethod = fakeRes()
  await handler(fakeReq('POST', '/launch-url', { host: '127.0.0.1:3080' }), wrongMethod.res)
  assert.equal((await wrongMethod.done).status, 405)
})

test('未知端点 → 404', async () => {
  const handler = createGateRoutes(makeDeps())
  const { res, done } = fakeRes()
  await handler(fakeReq('GET', '/unknown'), res)
  assert.equal((await done).status, 404)
})
