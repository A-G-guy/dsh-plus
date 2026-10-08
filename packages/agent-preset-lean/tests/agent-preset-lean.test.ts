import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import {
  apply,
  Config,
  LEAN_PERSONA_PREFIX,
  LEAN_PRESET_ID,
  leanPresetDefinition,
  resolvePersonaPrefix,
} from '../src/index.ts'

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

test('Given 默认配置 When 应用 Then 以 lean 身份注册精简预设', async () => {
  const harness = createFakeCtx()
  apply(harness.ctx, defaults())
  await flush()

  assert.equal(harness.registerCalls.length, 1)
  const [definition] = harness.registerCalls
  assert.ok(definition !== undefined)
  assert.equal(definition.id, LEAN_PRESET_ID)
  assert.equal(definition.name, '精简模式')
  assert.equal(
    definition.description,
    '精简编码预设：官方核心工具子集（shell/文件/联网/技能/待办/提问/计划/交付），去掉委派与编排类工具。',
  )
  assert.equal(definition.order, 5)
  const persona = definition.plugins.find((row) => row.id === 'persona')
  assert.deepEqual(persona?.config, {
    prefix: LEAN_PERSONA_PREFIX,
    suffix: 'Your working directory is {{cwd}}.',
  })
})

test('Given 定制显示面 When 构造声明 Then id 固定 lean、显示字段与次序来自配置', () => {
  const config = Config({ name: 'X', description: 'Y', order: 9 }) as Parameters<typeof apply>[1]
  const definition = leanPresetDefinition(config)
  assert.equal(definition.id, LEAN_PRESET_ID)
  assert.equal(definition.name, 'X')
  assert.equal(definition.description, 'Y')
  assert.equal(definition.order, 9)
})

test('Given personaPrefix 空白 When 解析 Then 回落内置文本', () => {
  const config = Config({ personaPrefix: '   ' }) as Parameters<typeof apply>[1]
  assert.equal(resolvePersonaPrefix(config), LEAN_PERSONA_PREFIX)

  const custom = Config({ personaPrefix: '自定义前缀' }) as Parameters<typeof apply>[1]
  assert.equal(resolvePersonaPrefix(custom), '自定义前缀')
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
    register: () => Promise.reject(new Error('Duplicate agent preset: lean')),
  })
  apply(harness.ctx, defaults())
  await flush()

  assert.equal(harness.warnings.length, 1)
  assert.match(
    harness.warnings[0] ?? '',
    /register lean preset failed: Duplicate agent preset: lean/,
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
