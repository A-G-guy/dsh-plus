import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DeepseekRouteRegistrar } from '../src/deepseek-routes.ts'
import type { ResolvedDeepseekRoute } from '../src/profiles-deepseek.ts'

/** 伪 DeepSeekAdapter：复刻官方 providerInfo 硬编码 "DeepSeek"，并留出构造入参。 */
class FakeDeepSeekAdapter {
  readonly deps: Record<string, unknown>
  constructor(deps: Record<string, unknown>) {
    this.deps = deps
  }
  providerInfo(provider: string) {
    return { id: provider, name: 'DeepSeek' }
  }
}

/** 构造入参中某钩子的类型视图（伪适配器不声明官方签名，测试按形状取用）。 */
function hook(adapter: FakeDeepSeekAdapter, name: string): Record<string, unknown> {
  const value = adapter.deps[name]
  assert.ok(typeof value === 'function', `构造入参应含 ${name}`)
  return value as unknown as Record<string, unknown>
}

interface FakeHandle {
  routes: string[]
  adapter: FakeDeepSeekAdapter
  replaceCount: number
  disposed: boolean
}

function fakeCtx(credentials?: { resolve(ref: unknown): Promise<{ value: string } | undefined> }) {
  const handles: FakeHandle[] = []
  const ctx = {
    get: (service: string) => (service === 'credentials' ? credentials : undefined),
    llm: {
      registerAdapter: (routes: string[], adapter: FakeDeepSeekAdapter) => {
        const rec: FakeHandle = { routes, adapter, replaceCount: 0, disposed: false }
        handles.push(rec)
        const handle = () => {
          rec.disposed = true
        }
        ;(handle as { replace?: () => void }).replace = () => {
          rec.replaceCount += 1
        }
        return handle
      },
    },
  }
  return { ctx: ctx as never, handles }
}

function fakeKit() {
  return {
    LlmError: class extends Error {
      readonly code: string
      constructor(message: string, code: string) {
        super(message)
        this.code = code
      }
    },
    assertUsableApiKey: (value: string) => value,
    deepseek: {
      DeepSeekAdapter: FakeDeepSeekAdapter,
      getOrCreateAnonymousUserId: () => 'anonymous-uid',
      catalogModelInfo: (provider: string, model: { id: string }) => ({
        provider,
        id: model.id,
      }),
    },
  } as never
}

function route(displayName: string, retryPolicy?: unknown): ResolvedDeepseekRoute {
  return {
    route: 'chatds',
    displayName,
    connection: {
      retryPolicy,
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      models: [{ id: 'deepseek-flash' }],
    } as never,
  }
}

/** 取首个注册记录（每个用例同步注册后应恰有一个 handle）。 */
function firstHandle(handles: FakeHandle[]): FakeHandle {
  const handle = handles[0]
  assert.ok(handle, '应有注册记录')
  return handle
}

function setup(
  displayName: string,
  credentials?: { resolve(ref: unknown): Promise<{ value: string } | undefined> },
) {
  const { ctx, handles } = fakeCtx(credentials)
  const current = new Map([['chatds', route(displayName)]])
  const registrar = new DeepseekRouteRegistrar({
    ctx,
    kit: fakeKit(),
    logger: { warn: () => {}, error: () => {} },
    routes: () => current,
  })
  return { registrar, current, handles }
}

test('providerInfo 返回路由 displayName 而非官方硬编码的 "DeepSeek"', () => {
  // Given —— displayName 为 newapi(chatds) 的 deepseek 路由
  const { registrar, current, handles } = setup('newapi(chatds)')
  // When —— 同步注册
  registrar.sync(current)
  // Then —— 模型目录分组名与 deepseek-official 可区分
  assert.deepEqual(firstHandle(handles).adapter.providerInfo('chatds'), {
    id: 'chatds',
    name: 'newapi(chatds)',
  })
})

test('displayName 变化触发 replace，分组名热更新', () => {
  // Given —— 已注册的路由
  const { registrar, current, handles } = setup('newapi(chatds)')
  registrar.sync(current)
  // When —— 配置改了 displayName
  current.set('chatds', route('改名(chatds)'))
  registrar.sync(current)
  // Then —— 原地 replace，providerInfo 读到新名
  const handle = firstHandle(handles)
  assert.equal(handle.replaceCount, 1)
  assert.equal(handle.disposed, false)
  assert.deepEqual(handle.adapter.providerInfo('chatds'), {
    id: 'chatds',
    name: '改名(chatds)',
  })
})

test('注册事实未变化时不 replace', () => {
  // Given —— 已注册的路由
  const { registrar, current, handles } = setup('newapi(chatds)')
  registrar.sync(current)
  // When —— 同名同策略再次同步
  registrar.sync(new Map([['chatds', route('newapi(chatds)')]]))
  // Then —— 无 replace
  assert.equal(firstHandle(handles).replaceCount, 0)
})

test('retryPolicy 变化仍触发 replace（回归）', () => {
  // Given —— 已注册的路由
  const { registrar, current, handles } = setup('newapi(chatds)')
  registrar.sync(current)
  // When —— 只改重试策略
  current.set('chatds', route('newapi(chatds)', { maxRetries: 3 }))
  registrar.sync(current)
  // Then —— replace 一次
  assert.equal(firstHandle(handles).replaceCount, 1)
})
test('resolveAuth：认证经请求头一次性给出（0.2.0 取代 resolveApiKey，x-api-key 同官方）', async () => {
  // Given —— 凭据服务解析出密钥
  const { registrar, current, handles } = setup('newapi(chatds)', {
    resolve: async () => ({ value: 'sk-test-key' }),
  })
  registrar.sync(current)
  // When —— 适配器按连接快照取认证
  const resolveAuth = hook(firstHandle(handles).adapter, 'resolveAuth')
  const auth = (await (resolveAuth as unknown as (c: unknown) => Promise<unknown>)({
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  })) as { headers: Record<string, string> }
  // Then —— 头形与官方 llm-deepseek-api-key 接线一致
  assert.deepEqual(auth.headers, { 'x-api-key': 'sk-test-key' })
})

test('discoverModels：0.2.0 listModels 改读该钩子，缺省即空目录（回归）', async () => {
  // Given —— route 携带物化模型目录
  const { registrar, current, handles } = setup('newapi(chatds)')
  registrar.sync(current)
  // When —— 适配器请求模型发现
  const discoverModels = hook(firstHandle(handles).adapter, 'discoverModels')
  const models = (await (discoverModels as unknown as (p: string) => Promise<unknown[]>)(
    'chatds',
  )) as {
    provider: string
    id: string
  }[]
  // Then —— 官方 catalogModelInfo 映射出非空目录，模型选择器才有项
  assert.deepEqual(models, [{ provider: 'chatds', id: 'deepseek-flash' }])
})
