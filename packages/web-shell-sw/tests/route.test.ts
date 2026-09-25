/**
 * sw.js 路由边界测试：HTTP 方法门与注册所需的响应头三件套。
 * 头即契约——Service-Worker-Allowed 缺失会让 scope '/' 注册直接失败。
 */
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'node:test'
import vm from 'node:vm'

import { serveServiceWorker } from '../src/route.ts'
import { buildServiceWorkerScript } from '../src/sw-script.ts'

interface Exchange {
  status: number
  headers: Record<string, string>
  body: string
}

/** 用替身请求/响应跑一次路由 handler，捕获写出的全部内容。 */
function serveExchange(method: string): Exchange {
  const out: Exchange = { status: 0, headers: {}, body: '' }
  const req = { method } as unknown as IncomingMessage
  const res = {
    writeHead: (status: number, headers?: Record<string, string>) => {
      out.status = status
      out.headers = headers ?? {}
    },
    end: (body?: string) => {
      out.body = body ?? ''
    },
  } as unknown as ServerResponse
  serveServiceWorker(req, res)
  return out
}

test('给定 GET 请求，当访问 sw.js 路由时，则返回脚本与注册所需的三个响应头', () => {
  const out = serveExchange('GET')
  assert.equal(out.status, 200)
  assert.match(out.headers['content-type'] ?? '', /javascript/)
  // scope '/' 依赖此头：脚本挂在 /dsh-plus/ 下，默认 scope 只到 /dsh-plus/。
  assert.equal(out.headers['service-worker-allowed'], '/')
  // 更新检查必须拿到最新脚本（现代浏览器主脚本本就绕过 HTTP 缓存，此为显式语义）。
  assert.equal(out.headers['cache-control'], 'no-cache')
  assert.equal(out.headers['content-length'], String(Buffer.byteLength(out.body)))
  assert.equal(out.body, buildServiceWorkerScript())
  assert.doesNotThrow(() => new vm.Script(out.body))
})

test('给定 HEAD 请求，当访问 sw.js 路由时，则同样给出头（body 由 Node 对 HEAD 丢弃）', () => {
  const out = serveExchange('HEAD')
  assert.equal(out.status, 200)
  assert.equal(out.headers['service-worker-allowed'], '/')
})

test('给定非 GET/HEAD 方法，当访问 sw.js 路由时，则 405 并声明 allow', () => {
  const out = serveExchange('POST')
  assert.equal(out.status, 405)
  assert.equal(out.headers.allow, 'GET, HEAD')
})
