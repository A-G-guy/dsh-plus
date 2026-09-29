import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import { apply, Config, chatPresetDefinition, inject, name } from '../src/index.ts'

/** 注册服务作用域的最小替身面。 */
interface FakeScope {
  effect: (fn: () => (() => void) | void) => void
  agentPresets: { register: (definition: PresetDefinition) => Promise<() => Promise<void>> }
}

/** 测试替身：观察惰性 inject 接线、register 声明与 effect 卸载语义。 */
function createFakeCtx(options?: {
  agentPresetsAvailable?: boolean
  register?: (definition: PresetDefinition) => Promise<() => Promise<void>>
}) {
  const available = options?.agentPresetsAvailable ?? true
  const registerCalls: PresetDefinition[] = []
  const warnings: string[] = []
  const cleanups: (() => void)[] = []
  let unregistered = 0
  const register =
    options?.register ??
    (async () => async () => {
      unregistered += 1
    })
  const scope: FakeScope = {
    effect: (fn) => {
      cleanups.push(fn() as () => void)
    },
    agentPresets: {
      register: (definition) => {
        registerCalls.push(definition)
        return register(definition)
      },
    },
  }
  const ctx = {
    logger: () => ({
      info: () => {},
      warn: (message: string) => warnings.push(message),
    }),
    inject: (services: string[], callback: (scope: FakeScope) => void) => {
      assert.deepEqual(services, ['agentPresets'])
      if (!available) return
      callback(scope)
    },
  }
  return {
    ctx: ctx as unknown as Context,
    registerCalls,
    warnings,
    cleanups,
    countUnregistered: () => unregistered,
  }
}

/** 默认配置的解析结果（schemastery 默认值）。 */
function defaults() {
  return Config({}) as Parameters<typeof apply>[1]
}

/** 排空 register 的 then/catch 微任务链。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

test('Given 默认配置 When 应用 Then 以 chat 身份注册且声明与遗留预设一致', async () => {
  const harness = createFakeCtx()
  apply(harness.ctx, defaults())
  await flush()

  assert.equal(name, 'dsh-plus-agent-preset-chat')
  assert.deepEqual(inject, [])
  assert.equal(harness.registerCalls.length, 1)
  const [definition] = harness.registerCalls
  assert.ok(definition !== undefined)
  assert.equal(definition.id, 'chat')
  assert.equal(definition.name, '聊天模式')
  assert.equal(
    definition.description,
    '纯对话模式：无工具调用、无 skill、无内置提示词，仅用于聊天。',
  )
  assert.deepEqual(definition.plugins, [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: { prefix: '', complete: true, includeRuntimeContext: false },
    },
  ])
})

test('Given 定制显示面 When 构造声明 Then id 固定 chat、显示字段来自配置', () => {
  const config = Config({ name: 'X', description: 'Y' }) as Parameters<typeof apply>[1]
  const definition = chatPresetDefinition(config)
  assert.equal(definition.id, 'chat')
  assert.equal(definition.name, 'X')
  assert.equal(definition.description, 'Y')
})

test('Given register 已完成 When effect 卸载 Then 调用注册表返回的注销函数', async () => {
  const harness = createFakeCtx()
  apply(harness.ctx, defaults())
  await flush()

  assert.equal(harness.cleanups.length, 1)
  harness.cleanups[0]?.()
  assert.equal(harness.countUnregistered(), 1)
})

test('Given register 尚未完成时卸载 When 注册完成 Then 立即注销、不泄漏子树', async () => {
  let release!: (dispose: () => Promise<void>) => void
  const pending = new Promise<() => Promise<void>>((resolve) => {
    release = resolve
  })
  const harness = createFakeCtx({ register: () => pending })
  apply(harness.ctx, defaults())

  harness.cleanups[0]?.()
  let disposed = 0
  release(async () => {
    disposed += 1
  })
  await flush()
  assert.equal(disposed, 1)
})

test('Given register 拒绝 When 应用 Then 记录 warn 且不抛出', async () => {
  const harness = createFakeCtx({
    register: () => Promise.reject(new Error('Duplicate agent preset: chat')),
  })
  apply(harness.ctx, defaults())
  await flush()

  assert.equal(harness.warnings.length, 1)
  assert.match(
    harness.warnings[0] ?? '',
    /register chat preset failed: Duplicate agent preset: chat/,
  )
})

test('Given enabled=false When 应用 Then 不注册（等价插件未安装）', () => {
  const harness = createFakeCtx()
  const config = Config({ enabled: false }) as Parameters<typeof apply>[1]
  apply(harness.ctx, config)
  assert.equal(harness.registerCalls.length, 0)
  assert.equal(harness.cleanups.length, 0)
})

test('Given agentPresets 服务缺席 When 应用 Then 行为等价插件缺席、不报错', () => {
  const harness = createFakeCtx({ agentPresetsAvailable: false })
  apply(harness.ctx, defaults())
  assert.equal(harness.registerCalls.length, 0)
  assert.equal(harness.cleanups.length, 0)
})
