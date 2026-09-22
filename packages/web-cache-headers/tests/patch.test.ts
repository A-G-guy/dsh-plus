/**
 * writeHead 进程级补丁的真实链路测试：临时端口起 node:http 服务器，
 * 处理器刻意模仿 dsh-host-frontend-static 的写头形态（writeHead 带/不带
 * 头对象、三参重载、setHeader 后 writeHead），验证补丁的增量语义。
 * 全程本机回环，零外呼、零 API 费用。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'

import { IMMUTABLE_CACHE_CONTROL } from '../src/decision.ts'
import { installImmutableAssetsPatch, uninstallImmutableAssetsPatch } from '../src/patch.ts'

let server: http.Server
let base: string

/** 模仿 frontend-static 的各种写头形态。 */
function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? '/'
  if (url.startsWith('/assets/msg-')) {
    res.writeHead(200, 'OK', { 'content-type': 'text/javascript; charset=utf-8' })
    res.end('x')
    return
  }
  if (url.startsWith('/assets/setheader-')) {
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.writeHead(200)
    res.end('x')
    return
  }
  if (url.startsWith('/assets/own-')) {
    res.writeHead(200, { 'cache-control': 'no-store' })
    res.end('x')
    return
  }
  if (url.startsWith('/assets/missing-')) {
    res.writeHead(404)
    res.end()
    return
  }
  if (url.startsWith('/assets/')) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    res.end('x')
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('x')
}

before(async () => {
  installImmutableAssetsPatch()
  server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

after(async () => {
  uninstallImmutableAssetsPatch()
  await new Promise((resolve) => server.close(resolve))
})

test('给定 GET /assets 命中路径，当响应写出时，则补 immutable 缓存头', async () => {
  const res = await fetch(`${base}/assets/index-8VXBH-f-.js`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), IMMUTABLE_CACHE_CONTROL)
})

test('给定 HEAD 请求，当响应写出时，则同样补缓存头', async () => {
  const res = await fetch(`${base}/assets/index-8VXBH-f-.js`, { method: 'HEAD' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), IMMUTABLE_CACHE_CONTROL)
})

test('给定 writeHead 三参重载（statusCode, statusMessage, headers），当写出时，则补缓存头', async () => {
  const res = await fetch(`${base}/assets/msg-index.js`)
  assert.equal(res.headers.get('cache-control'), IMMUTABLE_CACHE_CONTROL)
})

test('给定 setHeader 后 writeHead(200) 无头对象形态，当写出时，则补缓存头', async () => {
  const res = await fetch(`${base}/assets/setheader-index.js`)
  assert.equal(res.headers.get('cache-control'), IMMUTABLE_CACHE_CONTROL)
})

test('给定响应已自带 cache-control，当写出时，则原头保留、补丁不覆盖', async () => {
  const res = await fetch(`${base}/assets/own-index.js`)
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

test('给定 404 响应，当写出时，则不加缓存头', async () => {
  const res = await fetch(`${base}/assets/missing-index.js`)
  assert.equal(res.status, 404)
  assert.equal(res.headers.get('cache-control'), null)
})

test('给定 POST 写请求，当写出时，则不加缓存头', async () => {
  const res = await fetch(`${base}/assets/index-8VXBH-f-.js`, { method: 'POST' })
  assert.equal(res.headers.get('cache-control'), null)
})

test('给定 /assets 以外的路径，当写出时，则完全不受影响', async () => {
  const res = await fetch(`${base}/index.html`)
  assert.equal(res.headers.get('cache-control'), null)
})

test('给定重复安装未配平卸载，当计数归零后，则原型还原、后续响应不再加头', async () => {
  installImmutableAssetsPatch()
  installImmutableAssetsPatch()
  uninstallImmutableAssetsPatch()
  const still = await fetch(`${base}/assets/index-8VXBH-f-.js`)
  assert.equal(still.headers.get('cache-control'), IMMUTABLE_CACHE_CONTROL, '计数未归零应保持补丁')
  uninstallImmutableAssetsPatch()
  uninstallImmutableAssetsPatch()
  const restored = await fetch(`${base}/assets/index-8VXBH-f-.js`)
  assert.equal(restored.headers.get('cache-control'), null, '还原后应恢复原生行为')
  installImmutableAssetsPatch()
})
