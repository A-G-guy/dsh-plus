/**
 * sw.js 生成脚本的行为测试：把脚本放进 vm 沙箱、用替身驱动三类事件，
 * 逐条钉住安全验收条件——透传矩阵、入库门槛、编码头剥离、版本清理。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'

import { decideFetchAction } from '../src/decision.ts'
import { SW_CACHE_NAME, SW_CACHE_PREFIX } from '../src/ns.ts'
import { buildServiceWorkerScript } from '../src/sw-script.ts'

/** SW 的 fetch 事件替身（只暴露脚本实际触达的面）。 */
interface FakeRequest {
  readonly method: string
  readonly url: string
  readonly headers: { has: (name: string) => boolean }
}

type FetchListener = (event: {
  request: FakeRequest
  respondWith: (value: unknown) => void
}) => void

type ActivateListener = (event: { waitUntil: (value: Promise<unknown>) => void }) => void

interface Handlers {
  fetch?: FetchListener
  activate?: ActivateListener
}

interface Harness {
  handlers: Handlers
  /** cacheName → url → 入库响应。 */
  entries: Map<string, Map<string, unknown>>
  fetchCalls: string[]
  deleted: string[]
  context: vm.Context
  setFetch: (impl: (url: string) => Promise<unknown>) => void
}

/** 构造沙箱并装载生成的脚本（seeds 预置已有缓存内容）。 */
function createHarness(seeds: Record<string, Record<string, unknown>> = {}): Harness {
  const handlers: Handlers = {}
  const entries = new Map<string, Map<string, unknown>>()
  for (const [cacheName, bucket] of Object.entries(seeds)) {
    entries.set(cacheName, new Map(Object.entries(bucket)))
  }
  const fetchCalls: string[] = []
  const deleted: string[] = []
  let fetchImpl: (url: string) => Promise<unknown> = () => Promise.reject(new Error('fetch 未配置'))
  const sandbox = {
    self: {
      location: { origin: 'https://h.test' },
      addEventListener: (type: string, fn: unknown) => {
        if (type === 'fetch') handlers.fetch = fn as FetchListener
        if (type === 'activate') handlers.activate = fn as ActivateListener
      },
    },
    caches: {
      open: async (cacheName: string) => {
        let bucket = entries.get(cacheName)
        if (bucket === undefined) {
          bucket = new Map<string, unknown>()
          entries.set(cacheName, bucket)
        }
        const target = bucket
        return {
          match: async (request: FakeRequest): Promise<unknown> => target.get(request.url),
          put: async (request: FakeRequest, response: unknown): Promise<void> => {
            target.set(request.url, response)
          },
        }
      },
      keys: async (): Promise<string[]> => [...entries.keys()],
      delete: async (key: string): Promise<boolean> => {
        deleted.push(key)
        return entries.delete(key)
      },
    },
    fetch: (request: FakeRequest): Promise<unknown> => {
      fetchCalls.push(request.url)
      return fetchImpl(request.url)
    },
    URL,
    Headers,
    Response,
    console: { warn: () => {}, debug: () => {}, info: () => {} },
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(buildServiceWorkerScript(), context)
  return {
    handlers,
    entries,
    fetchCalls,
    deleted,
    context,
    setFetch: (impl) => {
      fetchImpl = impl
    },
  }
}

/** 构造一个 fetch 请求替身。 */
function fakeRequest(
  url: string,
  overrides: { method?: string; range?: boolean } = {},
): FakeRequest {
  const present = new Set<string>()
  if (overrides.range === true) present.add('range')
  return {
    method: overrides.method ?? 'GET',
    url,
    headers: { has: (name: string): boolean => present.has(name.toLowerCase()) },
  }
}

interface DispatchResult {
  readonly called: boolean
  readonly value: unknown
}

/** 派发一次 fetch 事件，返回 respondWith 是否被调用及其值。 */
function dispatchFetch(handlers: Handlers, request: FakeRequest): DispatchResult {
  const listener = handlers.fetch
  assert.ok(listener !== undefined, 'fetch listener 已注册')
  let result: DispatchResult = { called: false, value: undefined }
  listener({
    request,
    respondWith: (value: unknown) => {
      result = { called: true, value }
    },
  })
  return result
}

/** 构造带可控头的上游响应替身（type 强制为 basic，对齐同源 fetch 语义）。 */
function fakeResponse(
  opts: { status?: number; cacheControl?: string; encoding?: string; body?: string } = {},
): Response {
  const headers: Record<string, string> = {}
  if (opts.cacheControl !== undefined) headers['cache-control'] = opts.cacheControl
  if (opts.encoding !== undefined) headers['content-encoding'] = opts.encoding
  const response = new Response(opts.body ?? 'body-bytes', {
    status: opts.status ?? 200,
    headers,
  })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

/** 等一个宏任务，让 fire-and-forget 的 cache.put 微任务链落账。 */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

test('给定生成的 sw 脚本，当语法编译时，则通过且不含强制接管、缓存常量到位', () => {
  const source = buildServiceWorkerScript()
  assert.doesNotThrow(() => new vm.Script(source))
  // 不 skipWaiting / 不 clients.claim：新版本等标签页关闭，绝不中途换实现。
  assert.equal(source.includes('self.skipWaiting'), false)
  assert.equal(source.includes('clients.claim'), false)
  assert.ok(source.includes(`"${SW_CACHE_NAME}"`))
  assert.ok(source.includes(`"${SW_CACHE_PREFIX}"`))
})

test('给定数据面/认证/范围外路径，当 fetch 事件到达时，则不 respondWith（原生零干预）', () => {
  const harness = createHarness()
  const passthroughUrls = [
    'https://h.test/plugins/events?since=42',
    'https://h.test/api/session.list',
    'https://h.test/api/remote.mux',
    'https://h.test/?token=abc',
    'https://h.test/index.html?rev=1',
    'https://h.test/dsh-plus/shell-sw.js',
    'https://h.test/favicon.svg',
    'https://h.test/manifest.webmanifest',
    'https://h.test/assetsX/a.js',
    'https://h.test/pluginsX/a.js',
  ]
  for (const url of passthroughUrls) {
    assert.equal(dispatchFetch(harness.handlers, fakeRequest(url)).called, false, url)
  }
  assert.equal(
    dispatchFetch(harness.handlers, fakeRequest('https://h.test/assets/a.js', { method: 'POST' }))
      .called,
    false,
  )
  assert.equal(
    dispatchFetch(harness.handlers, fakeRequest('https://h.test/assets/a.js', { range: true }))
      .called,
    false,
  )
  assert.equal(
    dispatchFetch(harness.handlers, fakeRequest('https://evil.test/assets/a.js')).called,
    false,
  )
})

test('给定缓存已命中，当外壳静态资源到达时，则直接回缓存且不回源', async () => {
  const marker = { from: 'cache' }
  const url = 'https://h.test/assets/index-a1b2c3d4.js'
  const harness = createHarness({ [SW_CACHE_NAME]: { [url]: marker } })
  harness.setFetch(() => Promise.reject(new Error('不该回源')))
  const result = dispatchFetch(harness.handlers, fakeRequest(url))
  assert.equal(result.called, true)
  assert.equal(await (result.value as Promise<unknown>), marker)
  assert.deepEqual(harness.fetchCalls, [])
})

test('给定缓存未命中且上游带编码头，当回源成功时，则响应原样返回、入库副本剥离编码头', async () => {
  const harness = createHarness()
  harness.setFetch(() =>
    Promise.resolve(
      fakeResponse({ encoding: 'br', cacheControl: 'public, max-age=31536000, immutable' }),
    ),
  )
  const url = 'https://h.test/assets/index-a1b2c3d4.js'
  const result = dispatchFetch(harness.handlers, fakeRequest(url))
  assert.equal(result.called, true)
  const live = (await (result.value as Promise<Response>)) as Response
  assert.equal(live.status, 200)
  await flush()
  const stored = harness.entries.get(SW_CACHE_NAME)?.get(url)
  assert.ok(stored !== undefined, '可入库响应必须已入缓存')
  // fetch 的 body 已解码：保留编码头会造成下次命中的解码错配（经典 SW 缓存坑）。
  assert.equal((stored as Response).headers.get('content-encoding'), null)
  assert.equal((stored as Response).headers.get('vary'), null)
  assert.equal(
    (stored as Response).headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  )
})

test('给定 no-store 或非 200 响应，当回源成功时，则不入缓存（token 页免疫）', async () => {
  const harness = createHarness()
  harness.setFetch(() => Promise.resolve(fakeResponse({ cacheControl: 'no-store' })))
  let result = dispatchFetch(harness.handlers, fakeRequest('https://h.test/assets/tokenish.js'))
  await (result.value as Promise<unknown>)
  await flush()
  assert.equal(harness.entries.get(SW_CACHE_NAME)?.size ?? 0, 0)

  harness.setFetch(() => Promise.resolve(fakeResponse({ status: 404 })))
  result = dispatchFetch(harness.handlers, fakeRequest('https://h.test/assets/missing.js'))
  await (result.value as Promise<unknown>)
  await flush()
  assert.equal(harness.entries.get(SW_CACHE_NAME)?.size ?? 0, 0)
})

test('给定 index 且网络可用，当裁决时，则网络响应直达并更新缓存', async () => {
  const harness = createHarness()
  harness.setFetch(() => Promise.resolve(fakeResponse({ body: '<html>fresh</html>' })))
  const result = dispatchFetch(harness.handlers, fakeRequest('https://h.test/'))
  assert.equal(result.called, true)
  const response = (await (result.value as Promise<Response>)) as Response
  assert.equal(await response.text(), '<html>fresh</html>')
  await flush()
  assert.equal(harness.entries.get(SW_CACHE_NAME)?.has('https://h.test/'), true)
})

test('给定 index 且网络失败且有缓存，当裁决时，则缓存兜底（离线可开外壳）', async () => {
  const marker = { shell: 'cached' }
  const harness = createHarness({ [SW_CACHE_NAME]: { 'https://h.test/': marker } })
  harness.setFetch(() => Promise.reject(new Error('offline')))
  const result = dispatchFetch(harness.handlers, fakeRequest('https://h.test/'))
  assert.equal(result.called, true)
  assert.equal(await (result.value as Promise<unknown>), marker)
})

test('给定 index 且网络失败且无缓存，当裁决时，则拒绝（原生失败语义，不装壳）', async () => {
  const harness = createHarness()
  harness.setFetch(() => Promise.reject(new Error('offline')))
  const result = dispatchFetch(harness.handlers, fakeRequest('https://h.test/'))
  assert.equal(result.called, true)
  await assert.rejects(result.value as Promise<unknown>, /offline/)
})

test('给定多版本缓存共存，当 activate 时，则仅清同前缀旧版（他方缓存不动）', async () => {
  const staleKey = `${SW_CACHE_PREFIX}v0`
  const harness = createHarness({ [staleKey]: {}, [SW_CACHE_NAME]: {}, 'other-cache': {} })
  const activate = harness.handlers.activate
  assert.ok(activate !== undefined, 'activate listener 已注册')
  let waited: Promise<unknown> | undefined
  activate({
    waitUntil: (value: Promise<unknown>) => {
      waited = value
    },
  })
  assert.ok(waited !== undefined)
  await waited
  assert.deepEqual(harness.deleted, [staleKey])
  assert.deepEqual([...harness.entries.keys()].sort(), [SW_CACHE_NAME, 'other-cache'].sort())
})

test('给定内嵌的决策函数，当与模块实现逐例对比时，则行为完全一致', () => {
  const harness = createHarness()
  const embedded = vm.runInContext('decideFetch', harness.context) as (
    method: string,
    pathname: string,
    hasSearch: boolean,
    hasRange: boolean,
  ) => string
  const cases: [string, string, boolean, boolean][] = [
    ['GET', '/', false, false],
    ['GET', '/', true, false],
    ['GET', '/index.html', false, false],
    ['GET', '/plugins/events', false, false],
    ['GET', '/plugins/', true, false],
    ['GET', '/assets/a.js', false, false],
    ['GET', '/assets', false, false],
    ['GET', '/api/x', false, false],
    ['POST', '/assets/a.js', false, false],
    ['GET', '/assets/a.js', false, true],
  ]
  for (const [method, pathname, hasSearch, hasRange] of cases) {
    assert.equal(
      embedded(method, pathname, hasSearch, hasRange),
      decideFetchAction(method, pathname, hasSearch, hasRange),
      `${method} ${pathname}`,
    )
  }
})
