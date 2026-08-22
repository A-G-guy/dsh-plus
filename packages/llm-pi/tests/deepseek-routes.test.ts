import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DeepseekRouteRegistrar } from '../src/deepseek-routes.ts'
import type { ResolvedDeepseekRoute } from '../src/profiles-deepseek.ts'

/** 伪 DeepSeekAdapter：复刻官方 providerInfo 硬编码 "DeepSeek" 的行为。 */
class FakeDeepSeekAdapter {
  providerInfo(provider: string) {
    return { id: provider, name: 'DeepSeek' }
  }
}

interface FakeHandle {
  routes: string[]
  adapter: FakeDeepSeekAdapter
  replaceCount: number
  disposed: boolean
}

function fakeCtx() {
  const handles: FakeHandle[] = []
  const ctx = {
    get: () => undefined,
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
    },
  } as never
}

function route(displayName: string, retryPolicy?: unknown): ResolvedDeepseekRoute {
  return { route: 'chatds', displayName, connection: { retryPolicy } as never }
}

function setup(displayName: string) {
  const { ctx, handles } = fakeCtx()
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
  assert.deepEqual(handles[0].adapter.providerInfo('chatds'), {
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
  assert.equal(handles[0].replaceCount, 1)
  assert.equal(handles[0].disposed, false)
  assert.deepEqual(handles[0].adapter.providerInfo('chatds'), {
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
  assert.equal(handles[0].replaceCount, 0)
})

test('retryPolicy 变化仍触发 replace（回归）', () => {
  // Given —— 已注册的路由
  const { registrar, current, handles } = setup('newapi(chatds)')
  registrar.sync(current)
  // When —— 只改重试策略
  current.set('chatds', route('newapi(chatds)', { maxRetries: 3 }))
  registrar.sync(current)
  // Then —— replace 一次
  assert.equal(handles[0].replaceCount, 1)
})
