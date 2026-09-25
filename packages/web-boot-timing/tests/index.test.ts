/**
 * node 半接线测试：配置行的推/不推规则、渲染期热读取、宿主缺席空转。
 * 核心验收：enabled=false ⇒ 行缺席（浏览器半零行为）；行值 JSON 可序列化。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

import { apply, Config, inject, name, type WebBootTimingConfig } from '../src/index.ts'
import { TIMING_GLOBAL_KEY } from '../src/ns.ts'

/** 测试替身：观察 index 注入行的注册结果（含惰性 inject 的接线）。 */
function createFakeCtx(webServerAvailable = true): {
  ctx: Context
  listeners: ((table: IndexInjection[]) => void)[]
} {
  const listeners: ((table: IndexInjection[]) => void)[] = []
  const ctx = {
    logger: () => ({ info: () => {}, warn: () => {} }),
    inject: (services: string[], callback: (scope: unknown) => void) => {
      if (!webServerAvailable) return
      assert.deepEqual(services, ['webServer'])
      const scope = {
        on: (event: string, listener: (table: IndexInjection[]) => void) => {
          assert.equal(event, 'webserver/index-inject')
          listeners.push(listener)
          return () => {}
        },
        effect: (fn: () => unknown) => {
          fn()
        },
      }
      callback(scope)
    },
  }
  return { ctx: ctx as unknown as Context, listeners }
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
function defaults(): Parameters<typeof apply>[1] {
  return Config({}) as Parameters<typeof apply>[1]
}

test('给定默认配置，当应用时，则注入一行 global 配置（键名与 settleMs 到位）', () => {
  const rows = collectRows(defaults())
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.ok(row !== undefined && row.kind === 'global')
  assert.equal(row.name, TIMING_GLOBAL_KEY)
  assert.deepEqual(row.value, { enabled: true, settleMs: 1500 })
})

test('给定 enabled=false，当应用时，则不注入任何行（行缺席 = 浏览器半零行为）', () => {
  assert.deepEqual(collectRows(Config({ enabled: false }) as Parameters<typeof apply>[1]), [])
})

test('给定注入行，当检查值时，则 JSON 可序列化往返等值（global 渲染契约）', () => {
  const [row] = collectRows(defaults())
  assert.ok(row !== undefined && row.kind === 'global')
  assert.deepEqual(JSON.parse(JSON.stringify(row.value)), { enabled: true, settleMs: 1500 })
})

test('给定渲染间翻转 enabled，当再次触发注入时，则按最新值出/撤行（热生效）', () => {
  const { ctx, listeners } = createFakeCtx()
  const config: WebBootTimingConfig = { enabled: true, settleMs: 1000 }
  apply(ctx, config)
  const first: IndexInjection[] = []
  for (const listener of listeners) listener(first)
  assert.equal(first.length, 1)
  config.enabled = false
  const second: IndexInjection[] = []
  for (const listener of listeners) listener(second)
  assert.deepEqual(second, [])
})

test('给定未知配置键，当解析时，则被忽略且不改变默认值（前向兼容）', () => {
  const parsed = Config({ futureField: 'x' }) as Parameters<typeof apply>[1]
  assert.deepEqual(collectRows(parsed).length, 1)
})

test('给定宿主无 webServer（headless），当应用时，则不注册且不抛错', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(collectRows(defaults(), false), [])
  })
})

test('给定插件元数据，当读取时，则 name 与 inject 符合宿主约定', () => {
  assert.equal(name, 'dsh-plus-web-boot-timing')
  // 硬依赖必须为空：headless profile 无 webServer，硬 inject 会让本行永久
  // pending，使 boot 判定「1 entry did not activate」整体失败。
  assert.deepEqual([...inject], [])
})
