import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

/** 构建产物里的 stdio 入口（`dshctl test` 的构建步骤先于单测）。 */
const BIN = fileURLToPath(new URL('../lib/bin/mcp.js', import.meta.url))

/** 测试替身 CLI（可执行，带 shebang）。 */
const FAKE_CLI = fileURLToPath(new URL('./fixtures/fake-actual.mjs', import.meta.url))

/** 继承当前环境（替身 CLI 需要 PATH 解析 shebang）。 */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return env
}

/**
 * 起一个真实 stdio 会话：外部 MCP 宿主的用法与这里完全一致。
 *
 * `ACTUAL_SERVER_URL` 故意指向 127.0.0.1:1（必然拒连）——服务端版本探测是
 * 「有则更好」的信息，本测试断言它在不可达时优雅降级，且**不触碰任何真实服务**。
 */
async function withStdioClient<T>(
  fn: (client: Client, stderr: () => string) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN],
    env: { ...childEnv(), ACTUAL_CLI: FAKE_CLI, ACTUAL_SERVER_URL: 'http://127.0.0.1:1' },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'dsh-plus-test', version: '0.0.0' })
  let stderr = ''
  await client.connect(transport)
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  try {
    return await fn(client, () => stderr)
  } finally {
    await client.close().catch(() => undefined)
  }
}

test('given the stdio entry point, when an MCP host connects, then the derived catalog is served', async () => {
  await withStdioClient(async (client) => {
    const { tools } = await client.listTools()
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        'accounts',
        'budgets',
        'categories',
        'category-groups',
        'transactions',
        'payees',
        'tags',
        'rules',
        'schedules',
        'query',
        'server',
        'sync',
      ],
    )
    const accounts = tools.find((tool) => tool.name === 'accounts')
    assert.ok(accounts !== undefined)
    assert.equal(accounts.annotations?.readOnlyHint, false, 'accounts 含写动作')
    assert.equal(tools.find((tool) => tool.name === 'query')?.annotations?.readOnlyHint, true)
  })
})

test('given the stdio entry point, when calling a tool, then the CLI argv is executed', async () => {
  await withStdioClient(async (client) => {
    const result = await client.callTool({
      name: 'accounts',
      arguments: { action: 'list' },
    })
    assert.equal(result.isError, undefined)
    const content = result.content as { type: string; text: string }[]
    const payload = JSON.parse(content[0]?.text ?? '{}') as { argv?: string[] }
    assert.deepEqual(payload.argv, ['accounts', 'list', '--format', 'json'])
  })
})

test('given the stdio entry point, when a call fails, then stderr stays protocol-clean', async () => {
  await withStdioClient(async (client, stderr) => {
    const result = await client.callTool({
      name: 'accounts',
      arguments: { action: 'update', name: 'Wallet' },
    })
    assert.equal(result.isError, true)
    const content = result.content as { type: string; text: string }[]
    assert.match(content[0]?.text ?? '', /缺少必填参数：id/)
    assert.equal(
      stderr().includes('缺少必填参数'),
      false,
      '工具错误不得写进 stderr，也不得污染 stdout 协议通道',
    )
  })
})
