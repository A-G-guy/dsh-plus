/**
 * 进程内 MCP 会话：真实服务端 × 真实客户端的往返形状。
 *
 * 回归焦点——成功结果必须是 canonical MCP 结果信封，而不是解包后的业务值：
 * DSH 侧 `source: 'mcp'` 的条目由官方 `createMcpToolDefinition` 注册，裸值会被
 * 判为 invalid MCP result（数组）或渲染成空内容（对象），模型读不到任何数据。
 * @module @dsh-plus/actual/tests/mcp-session
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CapabilityEntry, EntryInvoker } from '@dsh-plus/actual-mcp'

import { createInProcessSession } from '../src/mcp-session.ts'

const ENTRY: CapabilityEntry = {
  name: 'accounts',
  description: 'Manage accounts',
  source: 'mcp',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['list'] } },
    required: ['action'],
    additionalProperties: false,
  },
}

/** 起一代会话，执行面由 `invoke` 替身决定。 */
async function sessionWith(invoke: EntryInvoker, timeoutMs = 5_000) {
  const session = createInProcessSession([ENTRY], invoke, timeoutMs)
  await session.connect(timeoutMs)
  return session
}

/** 从结果里取模型可见文本。 */
function textOf(value: unknown): string {
  const content = (value as { content?: { type?: string; text?: string }[] }).content
  assert.ok(Array.isArray(content), `结果缺少 content 数组：${JSON.stringify(value)}`)
  const block = content.find((item) => item.type === 'text')
  assert.ok(block, '结果缺少文本块')
  return block.text ?? ''
}

test('given an array result, when calling a tool, then the MCP result envelope is returned intact', async () => {
  const session = await sessionWith(async () => [{ id: 'a1', name: 'Checking' }])
  try {
    const value = await session.callTool('accounts', { action: 'list' }, { timeoutMs: 5_000 })
    assert.deepEqual(value, {
      content: [{ type: 'text', text: '[\n  {\n    "id": "a1",\n    "name": "Checking"\n  }\n]' }],
    })
  } finally {
    await session.close()
  }
})

test('given an object result, when calling a tool, then its text block is non-empty', async () => {
  const session = await sessionWith(async () => ({ version: { version: '26.10.0' } }))
  try {
    const value = await session.callTool('accounts', { action: 'list' }, { timeoutMs: 5_000 })
    assert.match(textOf(value), /26\.10\.0/)
  } finally {
    await session.close()
  }
})

test('given an empty result, when calling a tool, then an explicit placeholder is rendered', async () => {
  const session = await sessionWith(async () => '')
  try {
    const value = await session.callTool('accounts', { action: 'list' }, { timeoutMs: 5_000 })
    assert.equal(textOf(value), '(no output)')
  } finally {
    await session.close()
  }
})

test('given a failing tool, when calling, then the error text is raised and no envelope is returned', async () => {
  const session = await sessionWith(async () => {
    throw new Error('Budget not found')
  })
  try {
    await assert.rejects(
      session.callTool('accounts', { action: 'list' }, { timeoutMs: 5_000 }),
      /Budget not found/,
    )
  } finally {
    await session.close()
  }
})

test('given a connected session, when listing tools, then the entry schema round-trips', async () => {
  const session = await sessionWith(async () => [])
  try {
    const tools = await session.listTools()
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['accounts'],
    )
    assert.deepEqual(tools[0]?.inputSchema, ENTRY.inputSchema)
  } finally {
    await session.close()
  }
})
