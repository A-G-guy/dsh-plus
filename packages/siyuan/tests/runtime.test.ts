import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import type { McpLike, McpToolInfo } from '../src/mcp.ts'
import {
  type RuntimeConfig,
  type RuntimeDeps,
  type RuntimeLogger,
  SiyuanRuntime,
} from '../src/runtime.ts'

/** 测试用 token（仅验证链路，不涉任何真实数据）。 */
const CONF = JSON.stringify({ api: { token: 'tok-test-0123456789abcdef' } })

function fixtureText(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

/** 合成子命令 help：一个必选 --id、一个可选 --note。 */
function syntheticActionHelp(family: string, action: string): string {
  return `${action}\n\nUsage:\n  kernel ${family} ${action} --id <id> [flags]\n\nFlags:\n  -h, --help    help for ${action}\n      --id string     target id\n      --note string   note text\n\nGlobal Flags:\n      --dry-run   dry run\n  -f, --format string   output format\n`
}

/** 假 MCP 会话：可模拟连接失败与中途掉线。 */
interface FakeMcp extends McpLike {
  readonly callLog: { name: string; args: Record<string, unknown> }[]
  drop(): void
}

function makeFakeMcp(mode: 'up' | 'down', tools: McpToolInfo[]): FakeMcp {
  let connected = false
  const changeCbs = new Set<() => void>()
  const closeCbs = new Set<() => void>()
  const callLog: { name: string; args: Record<string, unknown> }[] = []
  const fake: FakeMcp = {
    callLog,
    get connected() {
      return connected
    },
    async connect() {
      if (mode === 'down') throw new Error('connect ECONNREFUSED 127.0.0.1:6806')
      connected = true
    },
    async listTools() {
      return tools
    },
    async callTool(name, args) {
      callLog.push({ name, args })
      return { content: [{ type: 'text', text: 'ok' }] }
    },
    onChange(cb) {
      changeCbs.add(cb)
      return () => changeCbs.delete(cb)
    },
    onClose(cb) {
      closeCbs.add(cb)
      return () => closeCbs.delete(cb)
    },
    async close() {
      connected = false
    },
    drop() {
      if (!connected) return
      connected = false
      for (const cb of closeCbs) cb()
    },
  }
  return fake
}

interface Harness {
  runtime: SiyuanRuntime
  deps: RuntimeDeps
  execLog: string[][]
  logs: string[]
  mcp: FakeMcp | undefined
}

async function makeHarness(options: {
  mcp: 'up' | 'down'
  config?: Partial<RuntimeConfig>
}): Promise<Harness> {
  const rootHelp = await fixtureText('kernel-help.txt')
  const fixtures = {
    document: await fixtureText('kernel-document-help.txt'),
    search: await fixtureText('kernel-search-help.txt'),
    sql: await fixtureText('kernel-sql-help.txt'),
  }
  const tools = JSON.parse(await fixtureText('mcp-tools-list.json')) as {
    result: { tools: McpToolInfo[] }
  }
  const execLog: string[][] = []
  const logs: string[] = []
  const logger: RuntimeLogger = {
    info: (message) => logs.push(`info:${message}`),
    warn: (message) => logs.push(`warn:${message}`),
    error: (message) => logs.push(`error:${message}`),
  }
  let mcp: FakeMcp | undefined
  const deps: RuntimeDeps = {
    async execFile(file, args) {
      execLog.push([file, ...args])
      if (file === 'docker' && args[0] === 'ps') {
        return { stdout: 'siyuan\tb3log/siyuan:latest\n', stderr: '', code: 0 }
      }
      if (args.includes('cat')) return { stdout: CONF, stderr: '', code: 0 }
      const kernelIndex = args.indexOf('/opt/siyuan/kernel')
      const argv = kernelIndex >= 0 ? args.slice(kernelIndex + 1) : args
      if (argv[0] === '--help') return { stdout: rootHelp, stderr: '', code: 0 }
      const [first, second, third] = argv
      if (second === '--help' && third === undefined && first !== undefined) {
        const text = (fixtures as Record<string, string | undefined>)[first]
        return text !== undefined
          ? { stdout: text, stderr: '', code: 0 }
          : { stdout: '', stderr: 'unknown command', code: 1 }
      }
      if (third === '--help' && first !== undefined && second !== undefined) {
        return { stdout: syntheticActionHelp(first, second), stderr: '', code: 0 }
      }
      return { stdout: JSON.stringify({ executed: argv }), stderr: '', code: 0 }
    },
    async readFile() {
      throw new Error('ENOENT')
    },
    async fetchJson() {
      return { ok: true, status: 200, body: { code: 0, data: '3.8.6' } }
    },
    env: {},
    createMcp: () => {
      mcp = makeFakeMcp(options.mcp, tools.result.tools)
      return mcp
    },
  }
  const config: RuntimeConfig = {
    mode: 'docker',
    endpoint: 'http://127.0.0.1:6806',
    container: '',
    cliCommand: [],
    cliWorkspace: '',
    token: '',
    allow: [],
    deny: [],
    ...options.config,
  }
  return {
    runtime: new SiyuanRuntime(config, deps, logger),
    deps,
    execLog,
    logs,
    get mcp() {
      return mcp
    },
  }
}

test('given a healthy SiYuan, when discovering, then a mixed manifest carries MCP tools with CLI fallback plans', async () => {
  const harness = await makeHarness({ mcp: 'up' })
  const seen: string[] = []
  harness.runtime.onChange((manifest) => seen.push(manifest.source))
  const manifest = await harness.runtime.discover()
  assert.equal(manifest.source, 'mixed')
  assert.equal(manifest.version, '3.8.6')
  assert.ok(manifest.entries.length >= 30, `MCP 能力应全量暴露，实际 ${manifest.entries.length}`)
  assert.deepEqual(seen, ['mixed'], '发现完成必须通知订阅者')

  const document = manifest.entries.find((entry) => entry.name === 'document')
  assert.ok(document !== undefined)
  assert.equal(document.source, 'mcp')
  assert.equal(document.cli?.actionMap?.delete, 'remove', '兜底计划须带显式差异映射')

  const search = manifest.entries.find((entry) => entry.name === 'search')
  assert.ok(search !== undefined)
  assert.equal(search.cli, undefined, 'search 的多 action 无兜底 → 记入 unmapped')
  assert.ok(manifest.drift.unmapped.includes('search'))
  assert.ok(manifest.drift.mcpOnly.includes('bazaar'), '无 CLI 家族的 MCP 能力记入 mcpOnly')

  assert.equal(harness.runtime.status().mcpConnected, true)
  assert.equal(harness.runtime.status().cliAvailable, true)
  harness.runtime.dispose()
})

test('given a healthy connection, when invoking through MCP, then the call forwards name, args and timeout', async () => {
  const harness = await makeHarness({ mcp: 'up' })
  const manifest = await harness.runtime.discover()
  const sql = manifest.entries.find((entry) => entry.name === 'sql')
  assert.ok(sql !== undefined)
  const result = await harness.runtime.invoke(
    sql,
    { action: 'query', stmt: 'SELECT 1' },
    { timeoutMs: 1234 },
  )
  assert.deepEqual(result, { content: [{ type: 'text', text: 'ok' }] })
  const call = harness.mcp?.callLog.at(-1)
  assert.ok(call !== undefined)
  assert.equal(call.name, 'sql')
  assert.equal((call.args as { stmt?: string }).stmt, 'SELECT 1')
  harness.runtime.dispose()
})

test('given a dropped MCP session, when invoking a mappable tool, then it degrades to CLI with globals appended', async () => {
  const harness = await makeHarness({ mcp: 'up' })
  const manifest = await harness.runtime.discover()
  const document = manifest.entries.find((entry) => entry.name === 'document')
  assert.ok(document !== undefined)
  harness.mcp?.drop()

  const value = (await harness.runtime.invoke(
    document,
    { action: 'create', id: 'x' },
    { timeoutMs: 500 },
  )) as {
    executed: string[]
  }
  const kernelCalls = harness.execLog.filter(
    (line) => line.includes('/opt/siyuan/kernel') && !line.includes('--help'),
  )
  const execCall = kernelCalls.find((line) => line.includes('create'))
  assert.ok(execCall !== undefined, '掉线后应改走 docker exec kernel')
  assert.deepEqual(execCall.slice(execCall.indexOf('/opt/siyuan/kernel') + 1), [
    'document',
    'create',
    '--id',
    'x',
    '-f',
    'json',
    '-w',
    '/siyuan/workspace',
  ])
  assert.deepEqual(value.executed.slice(0, 2), ['document', 'create'])
  harness.runtime.dispose()
})

test('given MCP down at boot, when discovering, then it degrades to CLI-native entries', async () => {
  const harness = await makeHarness({ mcp: 'down' })
  const manifest = await harness.runtime.discover()
  assert.equal(manifest.source, 'cli')
  assert.deepEqual(
    manifest.entries.map((entry) => entry.name).sort(),
    ['document', 'search', 'sql'],
    '降级仅暴露已采集到 help 的家族',
  )
  const document = manifest.entries.find((entry) => entry.name === 'document')
  assert.equal(document?.source, 'cli')
  const schema = document?.inputSchema as {
    properties: { action: { enum: string[] } }
    required: string[]
  }
  assert.ok(schema.properties.action.enum.includes('remove'), 'CLI 原生枚举来自 cobra 子命令')
  assert.deepEqual(schema.required, ['action'])
  assert.ok(harness.logs.some((line) => line.startsWith('warn:') && line.includes('降级')))
  harness.runtime.dispose()
})

test('given exposure filters, when discovering, then allow and deny gate the entry set', async () => {
  const allowed = await makeHarness({ mcp: 'up', config: { allow: ['document', 'sql'] } })
  const manifest = await allowed.runtime.discover()
  assert.deepEqual(manifest.entries.map((entry) => entry.name).sort(), ['document', 'sql'])
  allowed.runtime.dispose()

  const denied = await makeHarness({ mcp: 'up', config: { deny: ['sync', 'bazaar'] } })
  const deniedManifest = await denied.runtime.discover()
  assert.equal(
    deniedManifest.entries.some((entry) => entry.name === 'sync'),
    false,
  )
  assert.equal(
    deniedManifest.entries.some((entry) => entry.name === 'document'),
    true,
  )
  denied.runtime.dispose()
})

test('given both sources unavailable, when discovering, then the failure carries context and schedules retry', async () => {
  const harness = await makeHarness({ mcp: 'down', config: { mode: 'http', token: 't' } })
  await assert.rejects(harness.runtime.discover(), /SiYuan 不可达/)
  assert.ok(
    harness.logs.some((line) => line.startsWith('warn:')),
    '连接失败必须记录告警',
  )
  harness.runtime.dispose()
})
