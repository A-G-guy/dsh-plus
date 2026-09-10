/**
 * fetch 封装的运行期守卫行为：走真实 getJson/postJson 代码路径
 * （桩掉 globalThis.fetch，不触网）。
 *
 * 动机：客户端边界原先只有 `res.json() as T` 纯断言，坏结构会一路流到渲染期；
 * 典型后果是 `rows.map(...)` 抛未捕获异常导致整卡片白屏。守卫必须在边界 fail-fast。
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { getJson, postJson } from '../src/client/fetch.ts'

const realFetch = globalThis.fetch

/** 用给定状态码与 JSON 载荷替换 fetch。 */
function stubFetch(status: number, payload: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

interface Sample {
  items: unknown[]
}

function isSample(value: unknown): value is Sample {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { items?: unknown }).items)
}

test('未传守卫：行为与改造前一致（放行任意 JSON 结构）', async () => {
  stubFetch(200, { anything: 1 })
  assert.deepEqual(await getJson<{ anything: number }>('/x'), { anything: 1 })
})

test('传守卫：结构正确时放行', async () => {
  stubFetch(200, { items: [{ id: 'a' }] })
  assert.deepEqual(await getJson<Sample>('/x', isSample), { items: [{ id: 'a' }] })
})

test('传守卫：缺字段 / 错类型 / 非对象一律在边界抛错', async () => {
  for (const bad of [{}, { items: 'not-an-array' }, { items: null }, 'error page', null]) {
    stubFetch(200, bad)
    await assert.rejects(
      () => getJson<Sample>('/x', isSample),
      /响应结构不符合预期/,
      `应拦截：${JSON.stringify(bad)}`,
    )
  }
})

test('传守卫：postJson 同样生效', async () => {
  stubFetch(200, { items: [] })
  assert.deepEqual(await postJson<Sample>('/x', { a: 1 }, isSample), { items: [] })
  stubFetch(200, { nope: true })
  await assert.rejects(() => postJson<Sample>('/x', { a: 1 }, isSample), /响应结构不符合预期/)
})

test('非 2xx 优先抛服务端 error 字段（守卫不掩盖错误语义）', async () => {
  stubFetch(500, { error: 'boom' })
  await assert.rejects(() => getJson<Sample>('/x', isSample), /boom/)
})
