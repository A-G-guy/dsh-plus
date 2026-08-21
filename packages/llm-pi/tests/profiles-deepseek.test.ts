import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProviderProfileConfig } from '../src/config.ts'
import { Config } from '../src/config.ts'
import { buildDeepseekRoutes } from '../src/profiles-deepseek.ts'
import { loadVendoredKit } from '../src/resolve-dsh.ts'

const kit = loadVendoredKit()
const deps = { kit }

function routeConfig(
  profile: Partial<ProviderProfileConfig>,
): Record<string, ProviderProfileConfig> {
  return {
    relay: {
      adapter: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: 'TEST_KEY',
      ...profile,
    },
  }
}

function buildOne(profile: Partial<ProviderProfileConfig>) {
  const routes = buildDeepseekRoutes(routeConfig(profile), deps)
  const built = routes.get('relay')
  assert.ok(built, 'route relay 应存在')
  return built
}

test('视觉模型只写 id 即继承官方目录的 image 模态与像素预算', () => {
  const built = buildOne({ models: [{ id: 'deepseek-v4-flash-vision-exp' }] })
  const model = built.connection.models.find((m) => m.id === 'deepseek-v4-flash-vision-exp')
  assert.ok(model)
  assert.deepEqual(model.inputModalities, ['text', 'image'])
  assert.equal(model.imagePixelBudget, 640000)
  assert.ok(model.imageMaxBytes !== undefined && model.imageMaxBytes > 0)
})

test('文本模型同名继承官方上下文容量，不显式声明 image 模态', () => {
  const built = buildOne({ models: [{ id: 'deepseek-v4-flash' }] })
  const model = built.connection.models.find((m) => m.id === 'deepseek-v4-flash')
  assert.ok(model)
  assert.deepEqual(model.inputModalities, ['text'])
  assert.equal(model.contextWindow, 1_000_000)
})

test('条目显式字段逐字段覆盖官方继承值', () => {
  const built = buildOne({
    models: [
      {
        id: 'deepseek-v4-flash-vision-exp',
        name: 'Relay Vision',
        contextWindow: 512000,
        imageDetail: 'low',
      },
    ],
  })
  const model = built.connection.models[0]
  assert.ok(model)
  assert.equal(model.name, 'Relay Vision')
  assert.equal(model.contextWindow, 512000)
  assert.equal(model.imageDetail, 'low')
  // 未覆盖的字段仍继承官方目录
  assert.deepEqual(model.inputModalities, ['text', 'image'])
})

test("provider 级 extends: 'deepseek' 全量继承官方目录", () => {
  const built = buildOne({ extends: 'deepseek' })
  const ids = built.connection.models.map((m) => m.id)
  assert.ok(ids.includes('deepseek-v4-flash'))
  assert.ok(ids.includes('deepseek-v4-pro'))
  assert.ok(ids.includes('deepseek-v4-flash-vision-exp'))
})

test("模型级 extends: 'deepseek/<id>' 显式引用官方目录", () => {
  const built = buildOne({
    models: [{ id: 'my-vision-alias', extends: 'deepseek/deepseek-v4-flash-vision-exp' }],
  })
  const model = built.connection.models[0]
  assert.ok(model)
  assert.equal(model.id, 'my-vision-alias')
  assert.deepEqual(model.inputModalities, ['text', 'image'])
})

test('非法 extends 引用（非 deepseek 源）写入即拒绝', () => {
  assert.throws(
    () => buildOne({ models: [{ id: 'x', extends: 'openai/gpt-5' }] }),
    /extends 引用 "openai\/gpt-5" 非法/,
  )
})

test('官方目录未命中的显式 extends 写入即拒绝', () => {
  assert.throws(
    () => buildOne({ models: [{ id: 'x', extends: 'deepseek/no-such-model' }] }),
    /在官方目录中不存在/,
  )
})

test('pi 专有字段在 deepseek 路由上写入即拒绝', () => {
  for (const field of ['api', 'headers', 'transport', 'reasoning'] as const) {
    const profile: Record<string, unknown> = { models: [{ id: 'deepseek-v4-flash' }] }
    profile[field] =
      field === 'headers' ? { 'x-a': 'b' } : field === 'api' ? 'openai-completions' : 'x'
    assert.throws(() => buildOne(profile), /仅 adapter: pi 可用/, field)
  }
})

test('模型级 reasoningEfforts/compat 在 deepseek 路由上写入即拒绝', () => {
  assert.throws(
    () => buildOne({ models: [{ id: 'deepseek-v4-flash', reasoningEfforts: false }] }),
    /仅 adapter: pi 可用/,
  )
})

test('缺 apiKeyEnv 写入即拒绝（DeepSeekAdapter 无环境自发现）', () => {
  const routes: Record<string, ProviderProfileConfig> = {
    relay: {
      adapter: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      models: [{ id: 'deepseek-v4-flash' }],
    },
  }
  assert.throws(() => buildDeepseekRoutes(routes, deps), /需要 apiKeyEnv/)
})

test('缺 baseURL 且未 extends deepseek 写入即拒绝；extends 时继承官方端点', () => {
  assert.throws(
    () =>
      buildDeepseekRoutes(
        {
          relay: {
            adapter: 'deepseek',
            apiKeyEnv: 'TEST_KEY',
            models: [{ id: 'deepseek-v4-flash' }],
          },
        },
        deps,
      ),
    /需要 baseURL/,
  )
  const built = buildOne({ extends: 'deepseek', baseURL: undefined })
  assert.equal(built.connection.baseURL, 'https://api.deepseek.com')
})

test('image 预算字段配置在无 image 模态的模型上写入即拒绝', () => {
  assert.throws(
    () => buildOne({ models: [{ id: 'deepseek-v4-flash', imagePixelBudget: 1000 }] }),
    /未声明 image 模态/,
  )
})

test('运行时套件不含 dsh-llm-deepseek 时给出明确错误', () => {
  const { deepseek: _deepseek, ...rest } = kit
  assert.throws(
    () =>
      buildDeepseekRoutes(routeConfig({ models: [{ id: 'deepseek-v4-flash' }] }), {
        kit: rest,
      }),
    /dsh-llm-deepseek/,
  )
})

test('lenient 模式：route 级失败跳过并告警，extends 漂移降级为手写条目', () => {
  const warnings: string[] = []
  const providers: Record<string, ProviderProfileConfig> = {
    bad: {
      adapter: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      // 缺 apiKeyEnv 是 route 级失败：lenient 下整 route 跳过
      models: [{ id: 'deepseek-v4-flash' }],
    },
    drifted: {
      adapter: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: 'TEST_KEY',
      // 已写入的 extends 引用随官方目录漂移失效：降级为手写条目而非弄挂 route
      models: [{ id: 'x', extends: 'deepseek/no-such-model' }],
    },
    good: {
      adapter: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: 'TEST_KEY',
      models: [{ id: 'deepseek-v4-flash' }],
    },
  }
  const routes = buildDeepseekRoutes(providers, {
    ...deps,
    lenient: true,
    warn: (message) => warnings.push(message),
  })
  assert.equal(routes.has('bad'), false)
  assert.ok(routes.has('drifted'))
  assert.ok(routes.has('good'))
  assert.ok(warnings.some((message) => message.includes('"bad"')))
  assert.ok(warnings.some((message) => message.includes('降级为手写条目')))
})

test('pi 路由不被 deepseek 构建器拾取（adapter 缺省为 pi）', () => {
  const providers: Record<string, ProviderProfileConfig> = {
    chat: {
      extends: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: 'TEST_KEY',
      models: [{ id: 'deepseek-v4-flash' }],
    },
  }
  assert.equal(buildDeepseekRoutes(providers, deps).size, 0)
})

test('deepseek 专有策略字段透传进连接事实', () => {
  const built = buildOne({
    thinking: 'disabled',
    reasoningEffort: 'off',
    filesApiTimeoutMs: 30000,
    fileExpiresAfterSeconds: 7200,
    fileRefreshMarginSeconds: 600,
    maxImagesPerRequest: 100,
    imageOffloadCountQuantum: 10,
    models: [{ id: 'deepseek-v4-flash-vision-exp' }],
  })
  assert.equal(built.connection.defaults.thinking, 'disabled')
  assert.equal(built.connection.defaults.reasoningEffort, 'off')
  assert.equal(built.connection.filesApiTimeoutMs, 30000)
  assert.equal(built.connection.filePolicy.expiresAfterSeconds, 7200)
  assert.equal(built.connection.filePolicy.refreshMarginSeconds, 600)
  assert.equal(built.connection.maxImagesPerRequest, 100)
  assert.equal(built.connection.imageOffloadCountQuantum, 10)
})

test('重试策略透传并经官方解析（注册期事实）', () => {
  const built = buildOne({
    retryPolicy: { mode: 'normal', maxRetries: 3 },
    models: [{ id: 'deepseek-v4-flash' }],
  })
  assert.equal(built.connection.retryPolicy.mode, 'normal')
  assert.equal(built.connection.retryPolicy.maxRetries, 3)
})

test('settings 投递路径：schema 物化的空 dict/数组不触发误拒，官方继承不丢失', () => {
  // Given —— 模拟 dsh-settings 投递：用户原始配置先过 Config schema，
  // schemastery 会把 dict 物化为 {}、defaultInput 物化为 ['text']、模型 input 物化为 []
  const parsed = Config['~standard'].validate({
    providers: {
      relay: {
        adapter: 'deepseek',
        baseURL: 'https://gateway.example/v1',
        apiKeyEnv: 'TEST_KEY',
        models: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-flash-vision-exp' }],
      },
    },
  })
  assert.equal(parsed.issues, undefined)
  const materialized = parsed.value.providers['relay']
  assert.ok(materialized)
  assert.deepEqual(materialized.compat, {}) // 确认物化噪声存在（防测试随上游行为漂移而失效）
  assert.deepEqual(materialized.models[1]?.input, [])
  // When —— 走 settings validate 钩子同款严格构建
  const routes = buildDeepseekRoutes(parsed.value.providers, deps)
  // Then —— 不误拒，且视觉模型的官方 image 模态未被物化空数组覆盖
  const built = routes.get('relay')
  assert.ok(built)
  const vision = built.connection.models.find((m) => m.id === 'deepseek-v4-flash-vision-exp')
  assert.deepEqual(vision?.inputModalities, ['text', 'image'])
})

test('显式写出非空 pi 专有字段经 schema 投递仍被拒绝', () => {
  const parsed = Config['~standard'].validate({
    providers: {
      relay: {
        adapter: 'deepseek',
        baseURL: 'https://gateway.example/v1',
        apiKeyEnv: 'TEST_KEY',
        headers: { 'x-trace': '1' },
        models: [{ id: 'deepseek-v4-flash' }],
      },
    },
  })
  assert.equal(parsed.issues, undefined)
  assert.throws(
    () => buildDeepseekRoutes(parsed.value.providers, deps),
    /headers 仅 adapter: pi 可用/,
  )
})
