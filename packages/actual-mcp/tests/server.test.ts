import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

import type { CapabilityEntry } from '../src/contract.ts'
import type { EntryInvoker } from '../src/invoke.ts'
import { createActualMcpServer } from '../src/server.ts'

const READ_ENTRY: CapabilityEntry = {
  name: 'accounts',
  description: 'Manage accounts\nUsage: actual accounts [options] [command]',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list'], description: 'Operation. list: List all accounts' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  source: 'mcp',
  readOnly: true,
  cli: { family: 'accounts', kind: 'subcommands', actionMap: { list: 'list' } },
}

const WRITE_ENTRY: CapabilityEntry = {
  name: 'accounts-write',
  description: 'Create an account',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  source: 'mcp',
  cli: { family: 'accounts', kind: 'direct' },
}

/** 起一个进程内 MCP 会话，跑完即关。 */
async function withClient<T>(
  entries: CapabilityEntry[],
  invoke: EntryInvoker,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const server = createActualMcpServer({ entries, invoke, timeoutMs: 5_000 })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'dsh-plus-test', version: '0.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

test('given a catalog, when listing tools, then names, schemas and annotations are exposed', async () => {
  await withClient(
    [READ_ENTRY, WRITE_ENTRY],
    async () => '',
    async (client) => {
      const { tools } = await client.listTools()
      assert.deepEqual(
        tools.map((tool) => tool.name),
        ['accounts', 'accounts-write'],
      )
      const accounts = tools[0]
      assert.ok(accounts !== undefined)
      assert.equal(
        accounts.description,
        'Manage accounts\nUsage: actual accounts [options] [command]',
      )
      assert.deepEqual(accounts.inputSchema.required, ['action'])
      assert.equal(accounts.annotations?.readOnlyHint, true)
      assert.equal(tools[1]?.annotations?.readOnlyHint, false)
      assert.equal(tools[1]?.annotations?.destructiveHint, true)
    },
  )
})

test('given a successful call, when invoking, then the CLI value is rendered as JSON text', async () => {
  const seen: unknown[] = []
  await withClient(
    [READ_ENTRY],
    async (_entry, args) => {
      seen.push(args)
      return [{ id: 'a1', name: 'Checking' }]
    },
    async (client) => {
      const result = await client.callTool({ name: 'accounts', arguments: { action: 'list' } })
      assert.equal(result.isError, undefined)
      assert.deepEqual(seen, [{ action: 'list' }])
      const content = result.content as { type: string; text: string }[]
      assert.equal(content[0]?.type, 'text')
      assert.equal(content[0]?.text, '[\n  {\n    "id": "a1",\n    "name": "Checking"\n  }\n]')
    },
  )
})

test('given a failing call, when invoking, then an MCP error result carries the message', async () => {
  await withClient(
    [READ_ENTRY],
    async () => {
      throw new Error("error: required option '--name <name>' not specified")
    },
    async (client) => {
      const result = await client.callTool({ name: 'accounts', arguments: { action: 'list' } })
      assert.equal(result.isError, true)
      const content = result.content as { type: string; text: string }[]
      assert.equal(content[0]?.text, "error: required option '--name <name>' not specified")
    },
  )
})

test('given an out-of-enum action, when calling, then the schema rejects it before execution', async () => {
  let called = false
  await withClient(
    [READ_ENTRY],
    async () => {
      called = true
      return ''
    },
    async (client) => {
      const result = await client.callTool({ name: 'accounts', arguments: { action: 'destroy' } })
      assert.equal(result.isError, true, '越界枚举必须以错误结果返回')
      assert.equal(called, false, '非法入参不得触达执行器')
    },
  )
})
