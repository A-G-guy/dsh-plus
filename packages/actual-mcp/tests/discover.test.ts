import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { ActualCli, type CliConfig, type CliDeps } from '../src/cli-run.ts'
import { discover } from '../src/discover.ts'
import { createEntryInvoker } from '../src/invoke.ts'

/** 命令行路径 → 采集到的真实 help fixture。 */
const HELP_FILES: Record<string, string> = {
  '': 'root-help.txt',
  accounts: 'accounts-help.txt',
  'accounts list': 'accounts-list-help.txt',
  'accounts create': 'accounts-create-help.txt',
  'accounts update': 'accounts-update-help.txt',
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

/** 读取 fixture 文本。 */
function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

/** 记录所有非 help 调用，供 argv 断言。 */
interface Recorder {
  calls: string[][]
}

/** 替身 I/O：help 走真实 fixture，未收录的命令回落通用最小 help，其余调用返回可断言的 JSON。 */
function fakeDeps(recorder: Recorder): CliDeps {
  return {
    async execFile(file, args) {
      if (file !== 'actual') throw new Error(`spawn ${file} ENOENT`)
      if (args.includes('--version')) return { stdout: '26.10.0\n', stderr: '', code: 0 }
      const helpIndex = args.indexOf('--help')
      if (helpIndex >= 0) {
        const key = args.slice(0, helpIndex).join(' ')
        const name = HELP_FILES[key]
        if (name !== undefined) return { stdout: await fixture(name), stderr: '', code: 0 }
        return { stdout: syntheticHelp(key), stderr: '', code: 0 }
      }
      recorder.calls.push(args)
      return { stdout: JSON.stringify({ ok: true, argv: args }), stderr: '', code: 0 }
    },
    async fetchJson() {
      return { ok: true, status: 200, body: { build: { version: '26.10.0' } } }
    },
    env: {},
    resolveBundledCli: () => undefined,
  }
}

/** 未采集 fixture 的命令的通用最小 help（无子命令 → 直连工具，不产生缺失告警）。 */
function syntheticHelp(key: string): string {
  const name = key === '' ? 'actual' : `actual ${key}`
  return (
    `Usage: ${name} [options]\n\nSynthetic command\n\nOptions:\n` +
    '  --flag <value>  Synthetic flag\n  -h, --help      display help for command\n'
  )
}

/** 测试基准配置。 */
const CONFIG: CliConfig = {
  cliCommand: [],
  serverUrl: 'http://127.0.0.1:5006',
  password: '',
  sessionToken: '',
  syncId: 'test-sync',
  dataDir: '/tmp/actual-test',
  encryptionPassword: '',
  cacheTtl: 60,
  lockTimeout: 10,
}

/** 完成一次发现并装配执行器。 */
async function harness(recorder: Recorder, namePrefix = 'actual_') {
  const deps = fakeDeps(recorder)
  const discovery = await discover(CONFIG, deps, { namePrefix })
  const cli = new ActualCli(discovery.binding, CONFIG, deps)
  return { discovery, invoke: createEntryInvoker(cli, deps, discovery.tree) }
}

test('given the fixture CLI, when discovering, then every family becomes one tool', async () => {
  const { discovery } = await harness({ calls: [] })
  assert.equal(discovery.binding.version, '26.10.0')
  assert.equal(discovery.serverVersion, '26.10.0')
  assert.deepEqual(
    discovery.entries.map((entry) => entry.name),
    [
      'actual_accounts',
      'actual_budgets',
      'actual_categories',
      'actual_category-groups',
      'actual_transactions',
      'actual_payees',
      'actual_tags',
      'actual_rules',
      'actual_schedules',
      'actual_query',
      'actual_server',
      'actual_sync',
    ],
  )
})

test('given a discovered family tool, when invoking an action, then argv reaches the CLI', async () => {
  const recorder: Recorder = { calls: [] }
  const { discovery, invoke } = await harness(recorder)
  const entry = discovery.entries.find((candidate) => candidate.name === 'actual_accounts')
  assert.ok(entry !== undefined)
  const value = await invoke(
    entry,
    { action: 'update', id: 'acc-1', name: 'Wallet' },
    {
      timeoutMs: 5_000,
    },
  )
  assert.deepEqual(recorder.calls, [
    ['accounts', 'update', 'acc-1', '--name', 'Wallet', '--format', 'json'],
  ])
  assert.deepEqual(value, {
    ok: true,
    argv: ['accounts', 'update', 'acc-1', '--name', 'Wallet', '--format', 'json'],
  })
})

test('given a missing required positional, when invoking, then the error names it', async () => {
  const { discovery, invoke } = await harness({ calls: [] })
  const entry = discovery.entries.find((candidate) => candidate.name === 'actual_accounts')
  assert.ok(entry !== undefined)
  await assert.rejects(
    () => invoke(entry, { action: 'update', name: 'Wallet' }, { timeoutMs: 5_000 }),
    /缺少必填参数：id（actual accounts update）/,
  )
})

test('given a property that belongs to another action, when invoking, then it is refused', async () => {
  const { discovery, invoke } = await harness({ calls: [] })
  const entry = discovery.entries.find((candidate) => candidate.name === 'actual_accounts')
  assert.ok(entry !== undefined)
  await assert.rejects(
    () => invoke(entry, { action: 'list', name: 'Wallet' }, { timeoutMs: 5_000 }),
    /参数 name 不适用于 actual accounts list/,
  )
})

test('given the direct sync tool, when invoking, then booleans become switches', async () => {
  const recorder: Recorder = { calls: [] }
  const { discovery, invoke } = await harness(recorder)
  const entry = discovery.entries.find((candidate) => candidate.name === 'actual_sync')
  assert.ok(entry !== undefined)
  await invoke(entry, { status: true }, { timeoutMs: 5_000 })
  assert.deepEqual(recorder.calls, [['sync', '--status', '--format', 'json']])
})

test('given a choices option, when invoking out of range, then it is refused before execution', async () => {
  const recorder: Recorder = { calls: [] }
  const { discovery, invoke } = await harness(recorder)
  const entry = discovery.entries.find((candidate) => candidate.name === 'actual_server')
  assert.ok(entry !== undefined)
  await assert.rejects(
    () => invoke(entry, { action: 'get-id', type: 'budgets', name: 'x' }, { timeoutMs: 5_000 }),
    /--type 取值非法：budgets/,
  )
  assert.deepEqual(recorder.calls, [])
})

test('given the query tool, when invoking fields, then the shared table property becomes a positional', async () => {
  const recorder: Recorder = { calls: [] }
  const { discovery, invoke } = await harness(recorder)
  const entry = discovery.entries.find((candidate) => candidate.name === 'actual_query')
  assert.ok(entry !== undefined)
  await invoke(entry, { action: 'fields', table: 'transactions' }, { timeoutMs: 5_000 })
  assert.deepEqual(recorder.calls, [['query', 'fields', 'transactions', '--format', 'json']])
})
