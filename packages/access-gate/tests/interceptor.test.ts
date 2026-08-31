/**
 * interceptor.ts 单元测试：结构包装后的放行/拦截/豁免/dispose 还原。
 * 合并官方认证后：凭据校验以注入的 officialAuth 代理（官方 cookie），
 * token 交换请求与 PWA 安装资产豁免。
 */
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'node:test'

import { type AccessGateConfig, Config } from '../src/config.ts'
import {
  type GateWebServer,
  type InterceptorDeps,
  installGateInterceptor,
  isExemptPath,
  isTokenExchange,
} from '../src/interceptor.ts'

const ENABLED: AccessGateConfig = Config({
  enabled: true,
  allowedIps: ['100.108.58.63'],
})

/** 官方 cookie 校验代理：仅认 cookie 头 dsh-auth-x=valid。 */
const officialAuth = (req: IncomingMessage): boolean => req.headers.cookie === 'dsh-auth-x=valid'

function deps(config: () => AccessGateConfig): InterceptorDeps {
  return { config, officialAuth }
}

interface Captured {
  status: number
  body: string
  headers: Record<string, string | string[]>
}

function makeReq(overrides: {
  url?: string
  method?: string
  headers?: Record<string, string>
  remoteAddress?: string
}): IncomingMessage {
  return {
    url: overrides.url ?? '/api/x',
    method: overrides.method ?? 'POST',
    headers: overrides.headers ?? {},
    socket: { remoteAddress: overrides.remoteAddress ?? '127.0.0.1' },
  } as unknown as IncomingMessage
}

function makeRes(): { res: ServerResponse; done: Promise<Captured> } {
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

/** 官方 webserver 同构的最小 fake：match 分发 + upgrades 表 + fallback。 */
function makeServer(options: { withFallback?: boolean } = {}): GateWebServer {
  const exact = new Map<
    string,
    { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }
  >()
  const prefixes = new Map<
    string,
    {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => unknown
    }
  >()
  const upgrades = new Map<
    string,
    { path: string; handler: (req: IncomingMessage, socket: unknown, head: Buffer) => unknown }
  >()
  const server: GateWebServer = {
    exact,
    prefixes,
    upgrades: upgrades as unknown as GateWebServer['upgrades'],
    match(pathname: string) {
      const exactHit = exact.get(pathname)
      if (exactHit !== undefined) return exactHit
      let best:
        | { path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }
        | undefined
      for (const [prefix, route] of prefixes) {
        if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
        if (best === undefined || prefix.length > best.path.length) best = route
      }
      // 官方 webserver 语义：match 只查命名路由表，未命中返回 undefined；
      // fallback 由 handle() 的原生路径接管（不经 match）。
      return best
    },
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => unknown
    }) {
      const table = route.kind === 'exact' ? exact : prefixes
      table.set(route.path, route as never)
      return () => {
        table.delete(route.path)
      }
    },
    registerUpgrade(route: {
      path: string
      handler: (req: IncomingMessage, socket: unknown, head: Buffer) => unknown
    }) {
      if (upgrades.has(route.path)) throw new Error('duplicate')
      upgrades.set(route.path, route as never)
      return () => {
        upgrades.delete(route.path)
      }
    },
    registerFallback(handler: (req: IncomingMessage, res: ServerResponse) => unknown) {
      if (this.fallback !== undefined) throw new Error('fallback already registered')
      this.fallback = handler
      return () => {
        this.fallback = undefined
      }
    },
  }
  exact.set('/health', {
    kind: 'exact',
    path: '/health',
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    },
  })
  prefixes.set('/api', {
    kind: 'prefix',
    path: '/api',
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"api":true}')
    },
  })
  upgrades.set('/api/events.mux', {
    path: '/api/events.mux',
    handler: () => 'upgraded',
  } as never)
  if (options.withFallback === true) {
    server.fallback = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>index</html>')
    }
  }
  return server
}

const fakeCtx = { effect: () => () => {} } as unknown as Parameters<
  typeof installGateInterceptor
>[0]

/** 模拟 webserver handle() 原生语义：match 命中 → handler；未命中 → fallback（无则 404）。 */
async function dispatch(server: GateWebServer, req: IncomingMessage): Promise<Captured> {
  const { res, done } = makeRes()
  const route = server.match(new URL(req.url ?? '/', 'http://x').pathname) as
    | { handler: (req: IncomingMessage, res: ServerResponse) => unknown }
    | undefined
  if (route === undefined) {
    const fallback = server.fallback
    if (fallback === undefined) {
      res.writeHead(404)
      res.end()
    } else {
      await fallback(req, res)
    }
    return done
  }
  await route.handler(req, res)
  return done
}

test('拦截器：enabled=false 完全旁路', async () => {
  const server = makeServer({ withFallback: true })
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => Config({ enabled: false })),
  )
  const captured = await dispatch(server, makeReq({ headers: { 'x-forwarded-for': '8.8.8.8' } }))
  assert.equal(captured.status, 200)
  assert.equal(captured.body, '{"api":true}')
})

test('拦截器：本机直连放行；XFF 陌生 IP（白名单外）API 403', async () => {
  const server = makeServer({ withFallback: true })
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )

  const local = await dispatch(server, makeReq({}))
  assert.equal(local.status, 200)

  const blocked = await dispatch(server, makeReq({ headers: { 'x-forwarded-for': '8.8.8.8' } }))
  assert.equal(blocked.status, 403)
})

test('拦截器：未认证导航（白名单内、无 cookie）→ token 输入页', async () => {
  const server = makeServer({ withFallback: true })
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )
  const nav = await dispatch(
    server,
    makeReq({
      url: '/',
      method: 'GET',
      headers: { 'x-forwarded-for': '100.108.58.63', accept: 'text/html' },
    }),
  )
  assert.equal(nav.status, 200)
  assert.match(nav.body, /启动令牌/)
  assert.match(nav.body, /\/\?token=/)
})

test('拦截器：官方 cookie 有效放行；IP 围栏外即使持 cookie 也 403', async () => {
  const server = makeServer({ withFallback: true })
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )

  const authed = await dispatch(
    server,
    makeReq({ headers: { 'x-forwarded-for': '100.108.58.63', cookie: 'dsh-auth-x=valid' } }),
  )
  assert.equal(authed.status, 200)
  assert.equal(authed.body, '{"api":true}')

  const fenced = await dispatch(
    server,
    makeReq({ headers: { 'x-forwarded-for': '8.8.8.8', cookie: 'dsh-auth-x=valid' } }),
  )
  assert.equal(fenced.status, 403, '附加 IP 围栏优先于凭据')
})

test('拦截器：白名单为空时任何来源凭官方 cookie 即可放行', async () => {
  const server = makeServer({ withFallback: true })
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => Config({ enabled: true })),
  )
  const captured = await dispatch(
    server,
    makeReq({ headers: { 'x-forwarded-for': '8.8.8.8', cookie: 'dsh-auth-x=valid' } }),
  )
  assert.equal(captured.status, 200)
})

test('拦截器：官方令牌交换（GET /?token=）豁免，直达 fallback 由官方处理', async () => {
  const server = makeServer({ withFallback: true })
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )
  const captured = await dispatch(
    server,
    makeReq({ url: '/?token=abc', method: 'GET', headers: { 'x-forwarded-for': '8.8.8.8' } }),
  )
  assert.equal(captured.status, 200)
  assert.equal(captured.body, '<html>index</html>')
})

test('拦截器：豁免路径（自有端点 + PWA 安装资产）不过围栏', async () => {
  const server = makeServer({ withFallback: true })
  server.register({
    kind: 'prefix',
    path: '/dsh-plus/gate',
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"gate":true}')
    },
  })
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )
  const gate = await dispatch(
    server,
    makeReq({
      url: '/dsh-plus/gate/status',
      method: 'GET',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    }),
  )
  assert.equal(gate.status, 200)
  assert.equal(gate.body, '{"gate":true}')

  // PWA 安装资产未认证也必须可达（否则浏览器无法安装 PWA）
  assert.ok(isExemptPath('/manifest.webmanifest'))
  assert.ok(isExemptPath('/favicon.svg'))
  const manifest = await dispatch(
    server,
    makeReq({
      url: '/manifest.webmanifest',
      method: 'GET',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    }),
  )
  assert.equal(manifest.status, 200, 'manifest 豁免后落 fallback 正常服务')
})

test('令牌交换判定：仅 GET / 且带 token 参数', () => {
  assert.ok(isTokenExchange(makeReq({ url: '/?token=abc', method: 'GET' })))
  assert.ok(!isTokenExchange(makeReq({ url: '/?token=abc', method: 'POST' })))
  assert.ok(!isTokenExchange(makeReq({ url: '/api?token=abc', method: 'GET' })))
  assert.ok(!isTokenExchange(makeReq({ url: '/', method: 'GET' })))
})

test('拦截器：fallback（SPA）被围栏覆盖且放行时 SPA 语义保留', async () => {
  const server = makeServer({ withFallback: true })
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )
  // 白名单内但未认证 + 非 HTML accept → 403（而非落到 SPA）
  const blocked = await dispatch(
    server,
    makeReq({
      url: '/some/spa/route',
      method: 'GET',
      headers: { 'x-forwarded-for': '100.108.58.63' },
    }),
  )
  assert.equal(blocked.status, 403)
  // 本机直连 → 放行，SPA 正常服务
  const local = await dispatch(server, makeReq({ url: '/some/spa/route', method: 'GET' }))
  assert.equal(local.status, 200)
  assert.equal(local.body, '<html>index</html>')
  // match 未命中返回 undefined（webserver 原生语义，fallback 由其原生路径接管）
  assert.equal(server.match('/some/spa/route'), undefined)
})

test('拦截器：enabled=false 时 route 对象 handler 不被替换（旁路零开销）', async () => {
  const server = makeServer()
  const routeBefore = server.match('/health') as { handler: unknown }
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => Config({ enabled: false })),
  )
  await dispatch(server, makeReq({ url: '/health', method: 'GET' }))
  const routeAfter = server.match('/health') as { handler: unknown }
  assert.equal(routeAfter.handler, routeBefore.handler, 'disabled 时 match 返回原 route 对象')
})

test('拦截器：WS 升级先注册条目被拦；后注册条目同样被拦', async () => {
  const server = makeServer()
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )

  const ended: string[] = []
  const fakeSocket = { end: (chunk: string) => ended.push(chunk) }
  // 先注册条目（安装时已在位包装）
  const before = server.upgrades.get('/api/events.mux') as {
    handler: (req: IncomingMessage, socket: unknown, head: Buffer) => unknown
  }
  before.handler(
    makeReq({ headers: { 'x-forwarded-for': '100.108.58.63' } }),
    fakeSocket,
    Buffer.alloc(0),
  )
  assert.equal(ended.length, 1)
  assert.match(ended[0] ?? '', /403 Forbidden/)

  // 后注册条目（patch registerUpgrade 包装）
  server.registerUpgrade({
    path: '/api/events.host',
    handler: () => 'upgraded',
  } as never)
  const after = server.upgrades.get('/api/events.host') as {
    handler: (req: IncomingMessage, socket: unknown, head: Buffer) => unknown
  }
  const allowedResult = after.handler(
    makeReq({
      headers: { 'x-forwarded-for': '100.108.58.63', cookie: 'dsh-auth-x=valid' },
    }),
    fakeSocket,
    Buffer.alloc(0),
  )
  assert.equal(allowedResult, 'upgraded', '官方 cookie 有效且白名单内 → 放行')
  const blockedResult = after.handler(
    makeReq({ headers: { 'x-forwarded-for': '100.108.58.63' } }),
    fakeSocket,
    Buffer.alloc(0),
  )
  assert.equal(blockedResult, undefined, '无官方 cookie 拒绝且不进协议协商')
  assert.equal(ended.length, 2)
})

test('拦截器：dispose 完全还原（patch 方法卸载、在位 handler 还原、拦截失效）', async () => {
  const server = makeServer({ withFallback: true })
  const muxRoute = server.upgrades.get('/api/events.mux') as {
    handler: (req: IncomingMessage, socket: unknown, head: Buffer) => unknown
  }
  const originalMuxHandler = muxRoute.handler
  const originalFallbackRef = server.fallback

  const undo = installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )
  // 安装期：match 已被 patch（引用变化），在位 handler 已被替换
  assert.notEqual(server.match, server.match.bind(server))
  assert.notEqual(muxRoute.handler, originalMuxHandler)
  undo()

  // 卸载期：在位 handler 还原，patch 方法恢复官方语义（重复注册同路径恢复抛错行为）
  assert.equal(muxRoute.handler, originalMuxHandler, 'upgrade handler 还原')
  assert.equal(server.fallback, originalFallbackRef, 'fallback 还原为原始函数')
  assert.throws(
    () => server.registerUpgrade({ path: '/api/events.mux', handler: () => 'x' } as never),
    /duplicate/,
    'registerUpgrade 恢复原始重复检查',
  )
  const second = makeServer()
  assert.doesNotThrow(() => second.registerFallback(() => {}), 'registerFallback 恢复原语义')

  // 还原后拦截失效（回到无围栏行为）
  const captured = await dispatch(server, makeReq({ headers: { 'x-forwarded-for': '8.8.8.8' } }))
  assert.equal(captured.status, 200)
})

test('拦截器：registerFallback 后注册的 fallback 亦被包装', async () => {
  const server = makeServer()
  installGateInterceptor(
    fakeCtx,
    server,
    deps(() => ENABLED),
  )
  server.registerFallback((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html>index</html>')
  })
  const captured = await dispatch(
    server,
    makeReq({ url: '/spa', method: 'GET', headers: { 'x-forwarded-for': '8.8.8.8' } }),
  )
  assert.equal(captured.status, 403)
})

test('结构守卫：形状不符 fail-loud', () => {
  const broken = makeServer() as unknown as Record<string, unknown>
  const originalMatch = broken.match
  broken.match = 'not-a-function'
  assert.throws(
    () =>
      installGateInterceptor(
        fakeCtx,
        broken as unknown as GateWebServer,
        deps(() => ENABLED),
      ),
    /shape changed/,
  )
  broken.match = originalMatch
  broken.upgrades = []
  assert.throws(
    () =>
      installGateInterceptor(
        fakeCtx,
        broken as unknown as GateWebServer,
        deps(() => ENABLED),
      ),
    /shape changed/,
  )
})
