/**
 * fetch 决策纯函数测试：数据面/认证流零干预的验收条件逐条钉住。
 * 该函数会被 toString 内嵌进 sw.js（见 sw-script.test.ts 的等价性矩阵）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decideClientAction, decideFetchAction } from '../src/decision.ts'

test('给定 token 交换与带查询串的 index，当决策时，则一律原生透传（认证流零干预）', () => {
  assert.equal(decideFetchAction('GET', '/', true, false), 'passthrough')
  assert.equal(decideFetchAction('GET', '/index.html', true, false), 'passthrough')
})

test('给定无查询串的 index，当决策时，则 network-first-shell（在线恒用最新外壳）', () => {
  assert.equal(decideFetchAction('GET', '/', false, false), 'network-first-shell')
  assert.equal(decideFetchAction('GET', '/index.html', false, false), 'network-first-shell')
})

test('给定 SSE 端点，当决策时，则原生透传（长连接永不接管）', () => {
  assert.equal(decideFetchAction('GET', '/plugins/events', false, false), 'passthrough')
  assert.equal(decideFetchAction('GET', '/plugins/events', true, false), 'passthrough')
})

test('给定内容寻址静态资源，当决策时，则 cache-first', () => {
  assert.equal(decideFetchAction('GET', '/assets/index-a1b2c3d4.js', false, false), 'cache-first')
  // combo URL 经 URL 解析后 pathname 为 /plugins/（查询串归 search，缓存键含 rev）
  assert.equal(decideFetchAction('GET', '/plugins/', true, false), 'cache-first')
  assert.equal(decideFetchAction('GET', '/plugins/', false, false), 'cache-first')
})

test('给定非 GET 或带 Range 的请求，当决策时，则原生透传（写/分段语义不碰）', () => {
  assert.equal(decideFetchAction('POST', '/assets/a.js', false, false), 'passthrough')
  assert.equal(decideFetchAction('PUT', '/plugins/x', false, false), 'passthrough')
  assert.equal(decideFetchAction('GET', '/assets/a.js', false, true), 'passthrough')
})

test('给定段边界与范围外路径，当决策时，则原生透传', () => {
  const outside = [
    '/assets',
    '/assetsX/a.js',
    '/plugins',
    '/pluginsX/a.js',
    '/api',
    '/api/remote.mux',
    '/dsh-plus/shell-sw.js',
    '/favicon.svg',
  ]
  for (const pathname of outside) {
    assert.equal(decideFetchAction('GET', pathname, false, false), 'passthrough', pathname)
  }
})

test('给定无配置行，当决策时，则 skip（插件缺席零行为）', () => {
  assert.equal(
    decideClientAction(undefined, { isSecureContext: true, hasServiceWorker: true }),
    'skip',
  )
})

test('给定非安全上下文或无 SW 支持，当决策时，则 skip（局域网 http 直连降级）', () => {
  const enabled = { enabled: true }
  assert.equal(
    decideClientAction(enabled, { isSecureContext: false, hasServiceWorker: true }),
    'skip',
  )
  assert.equal(
    decideClientAction(enabled, { isSecureContext: true, hasServiceWorker: false }),
    'skip',
  )
})

test('给定 enabled=true 且环境支持，当决策时，则 register', () => {
  assert.equal(
    decideClientAction({ enabled: true }, { isSecureContext: true, hasServiceWorker: true }),
    'register',
  )
})

test('给定 enabled=false 且环境支持，当决策时，则 cleanup（一键恢复原生网络行为）', () => {
  assert.equal(
    decideClientAction({ enabled: false }, { isSecureContext: true, hasServiceWorker: true }),
    'cleanup',
  )
})
