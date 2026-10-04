import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import type { CapabilityEntry, CliConfig, CliDeps } from '@dsh-plus/actual-mcp'

import type { McpSessionLike } from '../src/mcp-session.ts'
import { ActualRuntime, type RuntimeConfig, type RuntimeDeps } from '../src/runtime.ts'

/** 命令行路径 → 采集到的真实 help fixture。 */
const HELP_FILES: Record<string, string> = {
  '': 'root-help.txt',
  accounts: 'accounts-help.txt',
  'accounts list': 'accounts-list-help.txt',
  'accounts update': 'accounts-update-help.txt',
  'accounts create': 'accounts-create-help.txt',
  'accounts close': 'accounts-close-help.txt',
  'accounts balance': 'accounts-balance-help.txt',
  transactions: 'transactions-help.txt',
  'transactions list': 'transactions-list-help.txt',
  'transactions add': 'transactions-add-help.txt',
  budgets: 'budgets-help.txt',
  'budgets set-amount': 'budgets-set-amount-help.txt',
  query: 'query-help.txt',
  'query run': 'query-run-help.txt',
  'query fields': 'query-fields-help.txt',
  server: 'server-help.txt',
  'server get-id': 'server-get-id-help.txt',
  sync: 'sync-help.txt',
}

/** 读取 actual-mcp 的 help fixture（跨包共享同一份真实文本）。 */
function fixture(name: string): Promise<string> {
  return readFile(new URL(`../../actual-mcp/tests/fixtures/${name}`, import.meta.url), 'utf8')
}

/** 测试基准 CLI 配置。 */
function cliConfig(): CliConfig {
  return {
    cliCommand: [],
    serverUrl: 'http://127.0.0.1:5006',
    password: '',
    sessionToken: '',
    syncId: 'sync-1',
    dataDir: '/tmp/actual-runtime-test',
    encryptionPassword: '',
    cacheTtl: 60,
    lockTimeout: 10,
  }
}

/** 记录调用并可断言的服务端版本。 */
interface Server {
  version: string
}

/** 替身 I/O：help 走真实 fixture，未收录命令回落通用最小 help。 */
function fakeDeps(server: Server): CliDeps {
  return {
    async execFile(_file, args) {
      if (args.includes('--version')) return { stdout: '26.10.0\n', stderr: '', code: 0 }
      const helpIndex = args.indexOf('--help')
      if (helpIndex >= 0) {
        const key = args.slice(0, helpIndex).join(' ')
        const name = HELP_FILES[key]
        if (name !== undefined) return { stdout: await fixture(name), stderr: '', code: 0 }
        return {
          stdout: `Usage: actual ${key} [options]\n\nSynthetic\n\nOptions:\n  -h, --help  display help for command\n`,
          stderr: '',
          code: 0,
        }
      }
      return { stdout: JSON.stringify({ ok: true, argv: args }), stderr: '', code: 0 }
    },
    async fetchJson() {
      return { ok: true, status: 200, body: { build: { version: server.version } } }
    },
    env: {},
    resolveBundledCli: () => undefined,
  }
}

/** 替身 MCP 会话：listTools 回放已注册条目，callTool 记录调用。 */
class FakeSession implements McpSessionLike {
  connected = false
  readonly calls: { name: string; args: Record<string, unknown> }[] = []
  private entries: readonly CapabilityEntry[] = []
  private readonly failConnect: boolean

  constructor(failConnect = false) {
    this.failConnect = failConnect
  }

  async connect(): Promise<void> {
    if (this.failConnect) throw new Error('MCP connect refused')
    this.connected = true
  }

  async listTools(): Promise<Pick<CapabilityEntry, 'name' | 'description' | 'inputSchema'>[]> {
    return this.entries.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }))
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args })
    return { via: 'mcp', name }
  }

  async close(): Promise<void> {
    this.connected = false
  }

  /** 会话构造时由 `createSession` 注入目录。 */
  setEntries(entries: readonly CapabilityEntry[]): void {
    this.entries = entries
  }
}

/** 组装运行时 + 替身会话 + 日志。 */
function harness(options: { overrides?: Partial<RuntimeConfig>; failConnect?: boolean } = {}) {
  const server: Server = { version: '26.10.0' }
  const session = new FakeSession(options.failConnect === true)
  const logs: string[] = []
  const deps: RuntimeDeps = {
    ...fakeDeps(server),
    createSession(entries) {
      session.setEntries(entries)
      return session
    },
  }
  const config: RuntimeConfig = {
    cli: cliConfig(),
    allow: [],
    deny: [],
    cliVersionPolicy: 'warn',
    toolCallTimeoutMs: 5_000,
    ...options.overrides,
  }
  const runtime = new ActualRuntime(config, deps, {
    info: (message) => logs.push(`info:${message}`),
    warn: (message) => logs.push(`warn:${message}`),
    error: (message) => logs.push(`error:${message}`),
  })
  return { runtime, session, server, logs }
}

/** 取指定族名的条目。 */
function entryOf(entries: CapabilityEntry[], name: string): CapabilityEntry {
  const entry = entries.find((candidate) => candidate.name === name)
  assert.ok(entry !== undefined, `缺少条目 ${name}`)
  return entry
}

test('given a CLI and a session, when discovering, then the manifest is MCP-sourced', async () => {
  const { runtime } = harness()
  const manifest = await runtime.discover()
  assert.equal(manifest.source, 'mixed')
  assert.equal(manifest.cliVersion, '26.10.0')
  assert.equal(manifest.serverVersion, '26.10.0')
  assert.deepEqual(
    manifest.entries.map((entry) => entry.source),
    manifest.entries.map(() => 'mcp'),
  )
  assert.equal(manifest.entries.length, 12)
  assert.equal(entryOf(manifest.entries, 'accounts').readOnly, undefined)
  assert.equal(entryOf(manifest.entries, 'query').readOnly, true)
  assert.equal(runtime.status().versionStatus, 'ok')
  assert.equal(runtime.status().mcpConnected, true)
})

test('given a CLI family, when discovering, then each entry keeps a CLI fallback plan', async () => {
  const { runtime } = harness()
  const manifest = await runtime.discover()
  const accounts = entryOf(manifest.entries, 'accounts')
  assert.equal(accounts.cli?.kind, 'subcommands')
  assert.deepEqual(accounts.cli?.actionMap?.list, 'list')
  assert.equal(entryOf(manifest.entries, 'sync').cli?.kind, 'direct')
  assert.deepEqual(manifest.drift.unmapped, [])
})

test('given a version mismatch, when policy is warn, then discovery continues with a warning', async () => {
  const { runtime, server, logs } = harness()
  server.version = '27.1.0'
  const manifest = await runtime.discover()
  assert.equal(manifest.serverVersion, '27.1.0')
  assert.equal(runtime.status().versionStatus, 'mismatch')
  assert.ok(
    logs.some((line) => line.startsWith('warn:') && line.includes('major.minor 不一致')),
    `应告警，实际日志：${logs.join(' | ')}`,
  )
})

test('given a version mismatch, when policy is strict, then discovery fails with guidance', async () => {
  const { runtime, server } = harness({ overrides: { cliVersionPolicy: 'strict' } })
  server.version = '27.1.0'
  await assert.rejects(() => runtime.discover(), /cliVersionPolicy=strict/)
})

test('given an unreachable server, when discovering, then the version is unknown, not fatal', async () => {
  const { runtime, server } = harness()
  server.version = ''
  const manifest = await runtime.discover()
  assert.equal(manifest.serverVersion, '')
  assert.equal(runtime.status().versionStatus, 'unknown')
})

test('given a connected session, when invoking, then the MCP path is used', async () => {
  const { runtime, session } = harness()
  const manifest = await runtime.discover()
  const value = await runtime.invoke(
    entryOf(manifest.entries, 'accounts'),
    { action: 'list' },
    {
      timeoutMs: 5_000,
    },
  )
  assert.deepEqual(value, { via: 'mcp', name: 'accounts' })
  assert.deepEqual(session.calls, [{ name: 'accounts', args: { action: 'list' } }])
})

test('given an unavailable session, when invoking, then the direct CLI path is used and keeps the MCP envelope', async () => {
  const { runtime, session } = harness()
  const manifest = await runtime.discover()
  // 会话在发现后掉线：模拟传输层失效
  session.connected = false
  const value = await runtime.invoke(
    entryOf(manifest.entries, 'accounts'),
    { action: 'list' },
    {
      timeoutMs: 5_000,
    },
  )
  assert.deepEqual(session.calls, [], '会话掉线时不得再走 MCP 通道')
  // 值来自 CLI 替身（{ok, argv}）而非会话；mcp 源条目在 DSH 侧由官方适配器
  // 注册，故兜底也必须交回同形状的信封。
  const envelope = value as { content?: { type: string; text: string }[] }
  assert.equal(envelope.content?.length, 1)
  assert.equal(envelope.content?.[0]?.type, 'text')
  assert.match(envelope.content?.[0]?.text ?? '', /"ok": true/)
  assert.match(envelope.content?.[0]?.text ?? '', /accounts/)
})

test('given a cli-source catalog, when invoking, then the raw CLI value is returned unwrapped', async () => {
  const { runtime } = harness({ failConnect: true })
  const manifest = await runtime.discover()
  const value = await runtime.invoke(
    entryOf(manifest.entries, 'accounts'),
    { action: 'list' },
    {
      timeoutMs: 5_000,
    },
  )
  // cli 源条目注册为裸 ToolDefinition 并自行渲染原始值——不该被包成信封
  assert.deepEqual(value, { ok: true, argv: ['accounts', 'list', '--format', 'json'] })
})

test('given allow and deny, when discovering, then exposure is filtered on raw family names', async () => {
  const { runtime } = harness({
    overrides: { allow: ['accounts', 'query', 'sync'], deny: ['sync'] },
  })
  const manifest = await runtime.discover()
  assert.deepEqual(
    manifest.entries.map((entry) => entry.name),
    ['accounts', 'query'],
  )
})

test('given subscribers, when a new manifest is published, then they are notified', async () => {
  const { runtime } = harness()
  const seen: number[] = []
  const off = runtime.onChange((manifest) => seen.push(manifest.entries.length))
  await runtime.discover()
  off()
  await runtime.discover()
  assert.deepEqual(seen, [12], '退订后不得再收到通知')
})

test('given an unusable MCP session, when discovering, then the catalog degrades to CLI entries', async () => {
  const { runtime, logs } = harness({ failConnect: true })
  const manifest = await runtime.discover()
  assert.equal(manifest.source, 'cli')
  assert.equal(manifest.entries.length, 12)
  assert.deepEqual(
    manifest.entries.map((entry) => entry.source),
    manifest.entries.map(() => 'cli'),
  )
  assert.deepEqual(manifest.drift.mcpOnly, [])
  assert.equal(runtime.status().mcpConnected, false)
  assert.ok(
    logs.some((line) => line.startsWith('warn:') && line.includes('降级为 CLI help 树目录')),
    `应告警降级，实际日志：${logs.join(' | ')}`,
  )
})

test('given a degraded catalog, when invoking, then execution still reaches the CLI', async () => {
  const { runtime } = harness({ failConnect: true })
  const manifest = await runtime.discover()
  const value = await runtime.invoke(
    entryOf(manifest.entries, 'accounts'),
    { action: 'list' },
    {
      timeoutMs: 5_000,
    },
  )
  assert.deepEqual(value, { ok: true, argv: ['accounts', 'list', '--format', 'json'] })
})

test('given a secret in a connection error, when recording status, then it is masked', async () => {
  const server: Server = { version: '26.10.0' }
  const session = new FakeSession()
  const deps: RuntimeDeps = {
    ...fakeDeps(server),
    async execFile() {
      throw new Error('ACTUAL_PASSWORD hunter2 rejected')
    },
    createSession() {
      return session
    },
  }
  const runtime = new ActualRuntime(
    {
      cli: { ...cliConfig(), password: 'hunter2' },
      allow: [],
      deny: [],
      cliVersionPolicy: 'warn',
      toolCallTimeoutMs: 5_000,
    },
    deps,
    { info: () => {}, warn: () => {}, error: () => {} },
  )
  await assert.rejects(() => runtime.discover())
  assert.equal(runtime.status().lastError?.includes('hunter2'), false)
  runtime.dispose()
})

test('given an unusable CLI, when discovering, then the error is recorded and reconnect is armed once', async () => {
  const server: Server = { version: '26.10.0' }
  const deps: RuntimeDeps = {
    ...fakeDeps(server),
    async execFile() {
      throw new Error('spawn actual ENOENT')
    },
    createSession: () => new FakeSession(),
  }
  const logs: string[] = []
  const runtime = new ActualRuntime(
    {
      cli: cliConfig(),
      allow: [],
      deny: [],
      cliVersionPolicy: 'warn',
      toolCallTimeoutMs: 5_000,
    },
    deps,
    { info: () => {}, warn: (message) => logs.push(message), error: () => {} },
  )
  await assert.rejects(() => runtime.discover(), /Actual CLI 不可用/)
  assert.match(runtime.status().lastError ?? '', /Actual CLI 不可用/)
  assert.equal(runtime.status().cliAvailable, false)
  runtime.dispose()
})

test('given an entry without a CLI plan, when the session is down, then invoke explains it', async () => {
  const { runtime, session } = harness()
  await runtime.discover()
  session.connected = false
  await assert.rejects(
    () =>
      runtime.invoke(
        { name: 'ghost', description: '', inputSchema: {}, source: 'mcp' },
        {},
        { timeoutMs: 1_000 },
      ),
    /Actual MCP 不可达且该能力无 CLI 回退：ghost/,
  )
})

test('given a runtime, when disposed, then the session is closed', async () => {
  const { runtime, session } = harness()
  await runtime.discover()
  runtime.dispose()
  assert.equal(session.connected, false)
})
