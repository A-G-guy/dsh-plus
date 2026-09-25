/**
 * node 半接线测试：配置行恒推（含 enabled=false，驱动浏览器半注销）、
 * 路由恒注册、宿主缺席空转。与 web-boot-timing 的「禁用不推」刻意不同。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

import { apply, Config, inject, name } from '../src/index.ts'
import { SW_GLOBAL_KEY, SW_SCRIPT_PATH } from '../src/ns.ts'

interface RouteRecord {
  kind: string
  path: string
  handler: unknown
}

/** 测试替身：观察注入行与路由注册（含惰性 inject 的接线）。 */
function createFakeCtx(webServerAvailable = true): {
  ctx: Context
  listeners: ((table: IndexInjection[]) => void)[]
  routes: RouteRecord[]
} {
  const listeners: ((table: IndexInjection[]) => void)[] = []
  const routes: RouteRecord[] = []
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
        webServer: {
          register: (route: RouteRecord) => {
            routes.push(route)
            return () => {}
          },
        },
      }
      callback(scope)
    },
  }
  return { ctx: ctx as unknown as Context, listeners, routes }
}

/** 走一遍「apply → 触发注入」的真实链路，连同注册的路由一并取回。 */
function setup(
  config: Parameters<typeof apply>[1],
  webServerAvailable = true,
): { rows: IndexInjection[]; routes: RouteRecord[] } {
  const { ctx, listeners, routes } = createFakeCtx(webServerAvailable)
  apply(ctx, config)
  const rows: IndexInjection[] = []
  for (const listener of listeners) listener(rows)
  return { rows, routes }
}

test('给定默认配置，当应用时，则推一行 global 配置并注册 sw.js 精确路由', () => {
  const { rows, routes } = setup(Config({}) as Parameters<typeof apply>[1])
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.ok(row !== undefined && row.kind === 'global')
  assert.equal(row.name, SW_GLOBAL_KEY)
  assert.deepEqual(row.value, { enabled: true })
  assert.equal(routes.length, 1)
  const route = routes[0]
  assert.ok(route !== undefined)
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, SW_SCRIPT_PATH)
  assert.equal(typeof route.handler, 'function')
})

test('给定 enabled=false，当应用时，则仍推配置行（驱动浏览器半注销）且路由保持注册', () => {
  const { rows, routes } = setup(Config({ enabled: false }) as Parameters<typeof apply>[1])
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.ok(row !== undefined && row.kind === 'global')
  assert.deepEqual(row.value, { enabled: false })
  assert.equal(routes.length, 1)
})

test('给定宿主无 webServer（headless），当应用时，则不注册且不抛错', () => {
  assert.doesNotThrow(() => {
    const { rows, routes } = setup(Config({}) as Parameters<typeof apply>[1], false)
    assert.deepEqual(rows, [])
    assert.deepEqual(routes, [])
  })
})

test('给定未知配置键，当解析时，则被忽略且不改变默认值（前向兼容）', () => {
  const parsed = Config({ futureField: 'x' }) as Parameters<typeof apply>[1]
  assert.equal(setup(parsed).rows.length, 1)
})

test('给定插件元数据，当读取时，则 name 与 inject 符合宿主约定', () => {
  assert.equal(name, 'dsh-plus-web-shell-sw')
  // 硬依赖必须为空：headless profile 无 webServer，硬 inject 会让本行永久
  // pending，使 boot 判定「1 entry did not activate」整体失败。
  assert.deepEqual([...inject], [])
})
