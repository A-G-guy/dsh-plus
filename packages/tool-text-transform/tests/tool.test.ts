import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import { apply, inject, name } from '../src/index.ts'

/**
 * 测试替身断言的最小结构面：本用例只观察注册结果、execute 的返回值与 render 的输出。
 * text_transform 是纯函数，不读取 exec，故 exec 形参留为 unknown。
 */
interface RegisteredToolDef {
  name: string
  timeoutMs?: number
  execute(args: { text: string; op: string }, exec: unknown): Promise<{ result: string }>
  output: {
    render(args: { text: string; op: string }, value: { result: string }): unknown[]
  }
}

function createFakeCtx() {
  const registered: RegisteredToolDef[] = []
  const ctx = {
    tools: {
      register(def: RegisteredToolDef) {
        registered.push(def)
        return () => {}
      },
    },
  }
  // 刻意的测试替身：apply 只使用 ctx.tools.register，其余 cordis 运行时面无需构造。
  return { ctx: ctx as unknown as Context, registered }
}

/** 取出唯一注册的工具定义；以断言收窄 undefined，不改变断言语义。 */
function soleTool(registered: RegisteredToolDef[]): RegisteredToolDef {
  const [tool] = registered
  assert.ok(tool !== undefined, 'expected exactly one registered tool')
  return tool
}

test('given the plugin module, when inspecting exports, then loader metadata is present', () => {
  assert.equal(name, 'dsh-plus-text-transform')
  assert.deepEqual([...inject], ['tools'])
})

test('given a registry context, when apply runs, then exactly one tool is registered', () => {
  const { ctx, registered } = createFakeCtx()
  apply(ctx)
  assert.equal(registered.length, 1)
  const tool = soleTool(registered)
  assert.equal(tool.name, 'text_transform')
  assert.equal(tool.timeoutMs, 5000)
})

test('given a valid call, when execute runs, then output matches the declared schema', async () => {
  const { ctx, registered } = createFakeCtx()
  apply(ctx)
  const tool = soleTool(registered)
  const value = await tool.execute({ text: 'Abc', op: 'reverse' }, {})
  assert.deepEqual(value, { result: 'cbA' })
  const rendered = tool.output.render({ text: 'Abc', op: 'reverse' }, value)
  assert.deepEqual(rendered, [{ type: 'text', text: 'cbA' }])
})

test('given an unknown op, when execute runs, then the registry boundary rejects it', async () => {
  const { ctx, registered } = createFakeCtx()
  apply(ctx)
  const tool = soleTool(registered)
  await assert.rejects(async () => tool.execute({ text: 'x', op: 'bogus' }, {}), /must be one of/)
})
