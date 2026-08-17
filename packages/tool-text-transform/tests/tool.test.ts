import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, inject, name } from '../src/index.ts'

function createFakeCtx() {
  const registered = []
  const ctx = {
    tools: {
      register(def) {
        registered.push(def)
        return () => {}
      },
    },
  }
  return { ctx, registered }
}

test('given the plugin module, when inspecting exports, then loader metadata is present', () => {
  assert.equal(name, 'dsh-custom-text-transform')
  assert.deepEqual([...inject], ['tools'])
})

test('given a registry context, when apply runs, then exactly one tool is registered', () => {
  const { ctx, registered } = createFakeCtx()
  apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'text_transform')
  assert.equal(registered[0].timeoutMs, 5000)
})

test('given a valid call, when execute runs, then output matches the declared schema', async () => {
  const { ctx, registered } = createFakeCtx()
  apply(ctx)
  const tool = registered[0]
  const value = await tool.execute({ text: 'Abc', op: 'reverse' }, {})
  assert.deepEqual(value, { result: 'cbA' })
  const rendered = tool.output.render({ text: 'Abc', op: 'reverse' }, value)
  assert.deepEqual(rendered, [{ type: 'text', text: 'cbA' }])
})

test('given an unknown op, when execute runs, then the registry boundary rejects it', async () => {
  const { ctx, registered } = createFakeCtx()
  apply(ctx)
  await assert.rejects(
    async () => registered[0].execute({ text: 'x', op: 'bogus' }, {}),
    /must be one of/,
  )
})
