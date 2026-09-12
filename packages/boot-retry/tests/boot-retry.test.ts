import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

import { bootRetryScript, SENTINEL } from '../src/boot-script.ts'
import { apply, Config, inject, name } from '../src/index.ts'

/** 测试替身：只观察 index 注入行的注册结果（含惰性 inject 的接线）。 */
function createFakeCtx(webServerAvailable = true) {
  const listeners: ((table: IndexInjection[]) => void)[] = []
  const effects: unknown[] = []
  const ctx = {
    logger: () => ({ info: () => {}, warn: () => {} }),
    // 惰性 inject：仅当宿主提供 webServer 时回调（模拟 cordis 语义）。
    inject: (services: string[], callback: (scope: unknown) => void) => {
      if (!webServerAvailable) return
      assert.deepEqual(services, ['webServer'])
      const scope = {
        logger: () => ({ info: () => {}, warn: () => {} }),
        on: (event: string, listener: (table: IndexInjection[]) => void) => {
          assert.equal(event, 'webserver/index-inject')
          listeners.push(listener)
          return () => {}
        },
        effect: (fn: () => unknown) => {
          effects.push(fn())
        },
      }
      callback(scope)
    },
  }
  return { ctx: ctx as unknown as Context, listeners, effects }
}

/** 走一遍「apply → 触发注入 → 取回行」的真实链路。 */
function collectRows(
  config: Parameters<typeof apply>[1],
  webServerAvailable = true,
): IndexInjection[] {
  const { ctx, listeners } = createFakeCtx(webServerAvailable)
  apply(ctx, config)
  const table: IndexInjection[] = []
  for (const listener of listeners) listener(table)
  return table
}

/** 默认配置的解析结果（schemastery 默认值）。 */
function defaults() {
  return Config({}) as Parameters<typeof apply>[1]
}

test('Given 默认配置 When 应用 Then 注入一行 head 内联脚本', () => {
  const rows = collectRows(defaults())
  assert.equal(rows.length, 1)
  const [row] = rows
  assert.ok(row !== undefined)
  assert.equal(row.kind, 'script')
  assert.equal(row.placement, 'head')
})

test('Given enabled=false When 应用 Then 不注入任何行', () => {
  const rows = collectRows({ ...defaults(), enabled: false })
  assert.deepEqual(rows, [])
})

test('Given 注入行 When 检查脚本文本 Then 不含 </script 且为幂等哨兵', () => {
  const [row] = collectRows(defaults())
  assert.ok(row !== undefined && row.kind === 'script')
  // 提前闭合 script 元素会截断注入，是这条通道唯一的硬性文本约束。
  assert.equal(row.text.includes('</script'), false)
  assert.ok(row.text.includes(SENTINEL))
})

test('Given 已存在 loadBundle When 脚本运行 Then 不覆盖他方实现', () => {
  // 结构守卫：官方将来自带实现、或他方插件先接管时，本插件必须让位。
  const source = bootRetryScript({
    maxAttempts: 3,
    backoffMs: [250, 750],
    retryShellScript: false,
    shellMaxAttempts: 2,
  })
  assert.ok(source.includes('transport.loadBundle === undefined'))
})

test('Given maxAttempts=1 When 脚本运行 Then 不重试（与官方行为等价）', () => {
  const source = bootRetryScript({
    maxAttempts: 1,
    backoffMs: [250],
    retryShellScript: false,
    shellMaxAttempts: 2,
  })
  assert.ok(source.includes('"maxAttempts":1'))
  // 单次尝试时 attempt>=maxAttempts 立即 reject，不会排下一次 spawn。
  assert.ok(source.includes('attempt >= maxAttempts'))
})

test('Given backoffMs 为空 When 生成退避 Then 退化为 0 而非崩溃', () => {
  const source = bootRetryScript({
    maxAttempts: 3,
    backoffMs: [],
    retryShellScript: true,
    shellMaxAttempts: 2,
  })
  assert.ok(source.includes('return 0'))
})

test('Given 配置 When 序列化进脚本 Then 退避表按序取用且末项重复', () => {
  const source = bootRetryScript({
    maxAttempts: 4,
    backoffMs: [100, 300],
    retryShellScript: true,
    shellMaxAttempts: 2,
  })
  assert.ok(source.includes('[100,300]'))
  assert.ok(source.includes('Math.min(attempt, list.length - 1)'))
})

test('Given 未知配置键 When 解析 Then 被忽略且不改变默认值', () => {
  // 前向兼容：官方新增字段或旧配置残留不得让插件启动失败。
  const parsed = Config({ futureField: 'x' }) as ReturnType<typeof defaults>
  assert.equal(parsed.enabled, true)
  assert.equal(parsed.maxAttempts, 3)
})

test('Given 插件元数据 When 读取 Then name 与 inject 符合宿主约定', () => {
  assert.equal(name, 'dsh-plus-boot-retry')
  // 硬依赖必须为空：headless profile 无 webServer，硬 inject 会让本行永久
  // pending，使 boot 判定「1 entry did not activate」整体失败。
  assert.deepEqual([...inject], [])
})

test('Given 宿主无 webServer（headless）When 应用 Then 不注册且不抛错', () => {
  // 回归：smoke-prod 实测的 boot 失败场景——本插件必须在无 webServer 的
  // profile 里静默空转，而不是拖垮同 profile 的其它插件。
  assert.doesNotThrow(() => {
    collectRows(defaults(), false)
  })
  assert.deepEqual(collectRows(defaults(), false), [])
})

test('Given enabled=false When 走完整链路 Then 不触碰任何事件', () => {
  const { ctx, listeners } = createFakeCtx()
  apply(ctx, { ...defaults(), enabled: false })
  assert.equal(listeners.length, 0)
})
