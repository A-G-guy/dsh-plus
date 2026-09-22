/**
 * 缓存头决策纯函数测试：Given-When-Then，覆盖路径段边界、方法、状态码、
 * 既有缓存头优先级与查询串剥离。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decideCacheControl, IMMUTABLE_CACHE_CONTROL, pathnameOf } from '../src/decision.ts'

test('给定 GET /assets/ 内容哈希 js 且 200 无缓存头，当决策时，则补 immutable', () => {
  const header = decideCacheControl('GET', '/assets/index-8VXBH-f-.js', 200, false)
  assert.equal(header, IMMUTABLE_CACHE_CONTROL)
})

test('给定 HEAD 请求，当决策时，则同样补 immutable（静态资源读取语义）', () => {
  const header = decideCacheControl('HEAD', '/assets/index-8VXBH-f-.js', 200, false)
  assert.equal(header, IMMUTABLE_CACHE_CONTROL)
})

test('给定带查询串的 URL，当决策时，则按路径部分命中', () => {
  assert.equal(
    decideCacheControl('GET', '/assets/index-8VXBH-f-.js?v=2', 200, false),
    IMMUTABLE_CACHE_CONTROL,
  )
  assert.equal(pathnameOf('/assets/a.js?v=2'), '/assets/a.js')
  assert.equal(pathnameOf('/assets/a.js'), '/assets/a.js')
})

test('给定非 GET/HEAD 方法，当决策时，则不干预', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.equal(decideCacheControl(method, '/assets/a.js', 200, false), undefined, method)
  }
})

test('给定非 200 状态，当决策时，则不干预（错误/重定向不缓存）', () => {
  for (const status of [201, 204, 301, 304, 401, 403, 404, 405, 500]) {
    assert.equal(
      decideCacheControl('GET', '/assets/a.js', status, false),
      undefined,
      String(status),
    )
  }
})

test('给定路径段边界用例，当决策时，则仅 /assets/ 前缀命中', () => {
  assert.equal(decideCacheControl('GET', '/assets/a.js', 200, false), IMMUTABLE_CACHE_CONTROL)
  // 段边界：/assets 根、/assetsX 前缀、兄弟路径均不命中
  assert.equal(decideCacheControl('GET', '/assets', 200, false), undefined)
  assert.equal(decideCacheControl('GET', '/assetsX/a.js', 200, false), undefined)
  assert.equal(decideCacheControl('GET', '/assets-misc/a.js', 200, false), undefined)
  assert.equal(decideCacheControl('GET', '/', 200, false), undefined)
  assert.equal(decideCacheControl('GET', '/plugins/x/client.js?rev=1', 200, false), undefined)
})

test('给定响应已带 cache-control（core 未来自带策略），当决策时，则已有头永远优先', () => {
  assert.equal(decideCacheControl('GET', '/assets/a.js', 200, true), undefined)
})
