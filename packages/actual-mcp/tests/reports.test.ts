/**
 * 伴侣报表 CLI 的接线测试：能力入目录、漂移不计扩展族、argv 映射与同队列执行。
 * @module @dsh-plus/actual-mcp/tests/reports
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { FAMILY_CAPABILITIES } from '@dsh-plus/actual-reports'

import { ActualCli, type CliConfig, type CliDeps } from '../src/cli-run.ts'
import type { CapabilityEntry } from '../src/contract.ts'
import type { HelpTree } from '../src/derive.ts'
import { computeDrift } from '../src/derive.ts'
import { discover, reportsCapabilities } from '../src/discover.ts'
import { parseCommanderHelp } from '../src/help.ts'
import { buildReportsArgv, createEntryInvoker, REPORTS_CLI_ENTRY_ENV } from '../src/invoke.ts'

/** 已经装好的伴侣 CLI 路径（替身，不落盘）。 */
const REPORTS_CLI = '/fake/@dsh-plus/actual-reports/lib/bin/report.js'

/** 基准配置（接报告族不需要 syncId）。 */
const CONFIG: CliConfig = {
  cliCommand: ['actual'],
  serverUrl: 'http://127.0.0.1:5006',
  password: '',
  sessionToken: '',
  syncId: 'test-sync',
  dataDir: '/tmp/actual-test',
  encryptionPassword: '',
  cacheTtl: 60,
  lockTimeout: 10,
}

/** 一次 spawn 的记录。 */
interface Spawn {
  file: string
  args: string[]
  env: Record<string, string> | undefined
}

/** 替身 I/O：记录 spawn，按文件返回可断言的 JSON。 */
function depsOf(spawns: Spawn[], options: { withReports?: boolean } = {}): CliDeps {
  const base: CliDeps = {
    async execFile(file, args, execOptions) {
      spawns.push({ file, args, env: execOptions?.env })
      if (file === 'actual' && args.includes('--version')) {
        return { stdout: '26.10.0\n', stderr: '', code: 0 }
      }
      return { stdout: JSON.stringify({ ok: true, argv: args }), stderr: '', code: 0 }
    },
    async fetchJson() {
      return { ok: true, status: 200, body: { build: { version: '26.10.0' } } }
    },
    env: {},
    resolveBundledCli: () => undefined,
  }
  if (options.withReports !== false) base.resolveReportsCli = () => REPORTS_CLI
  return base
}

/** 空的 help 树（报表族不做 help 采集）。 */
const EMPTY_TREE: HelpTree = {
  root: parseCommanderHelp('Usage: actual [options]\n'),
  families: new Map(),
  actions: new Map(),
}

/** 官方 CLI 的 accounts 族 help 树（真实 fixture，供官方链路对照）。 */
async function accountsTree(): Promise<HelpTree> {
  const read = (name: string): Promise<string> =>
    readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  return {
    root: parseCommanderHelp(await read('root-help.txt')),
    families: new Map([['accounts', parseCommanderHelp(await read('accounts-help.txt'))]]),
    actions: new Map([['accounts list', parseCommanderHelp(await read('accounts-list-help.txt'))]]),
  }
}

/** 报表能力条目。 */
function reportEntry(): CapabilityEntry {
  const capability = FAMILY_CAPABILITIES.find((item) => item.name === 'report')
  assert.ok(capability)
  return {
    name: capability.name,
    description: capability.description,
    inputSchema: capability.inputSchema,
    source: 'cli',
    reports: capability.reports,
  }
}

test('伴侣 CLI 可解析时报表族入目录，不可解析时只留告警', () => {
  const available = reportsCapabilities(depsOf([]))
  assert.deepEqual(
    available.entries.map((entry) => entry.name),
    ['report', 'dashboard'],
  )
  assert.equal(available.warning, undefined)
  assert.equal(available.entries[0]?.reports?.kind, 'reports')

  const missing = reportsCapabilities(depsOf([], { withReports: false }))
  assert.deepEqual(missing.entries, [])
  assert.match(missing.warning ?? '', /报表\/仪表盘能力未启用/)
})

test('发现结果包含扩展族，且该族不计入交叉校验漂移', async () => {
  const discovery = await discover({ ...CONFIG, cliCommand: [] }, depsOf([]))
  assert.ok(discovery.entries.some((entry) => entry.name === 'report'))
  const extras = discovery.entries.filter((entry) => entry.reports !== undefined).map((e) => e.name)
  assert.deepEqual(extras, ['report', 'dashboard'])
  const drift = computeDrift(discovery.entries, discovery.tree.families, [], extras)
  assert.equal(drift.cliOnly.includes('report'), false)
  assert.equal(drift.mcpOnly.includes('report'), false)
})

test('argv 映射：字符串/JSON/布尔与必填校验', () => {
  const spec = FAMILY_CAPABILITIES[0]?.reports.actions.find((item) => item.action === 'data')
  assert.ok(spec)
  const built = buildReportsArgv('report', spec, {
    action: 'data',
    reportId: 'rep-1',
    overrides: { showEmpty: true },
    today: '2025-03-15',
  })
  assert.deepEqual(built, {
    argv: [
      'report',
      'data',
      '--report-id',
      'rep-1',
      '--overrides',
      '{"showEmpty":true}',
      '--today',
      '2025-03-15',
    ],
    missing: [],
    ignored: [],
  })

  const create = FAMILY_CAPABILITIES[0]?.reports.actions.find((item) => item.action === 'create')
  assert.ok(create)
  assert.deepEqual(buildReportsArgv('report', create, { action: 'create' }).missing, ['definition'])
  const wrongAction = buildReportsArgv('report', create, { action: 'create', force: true })
  assert.deepEqual(wrongAction.ignored, ['force'])
  // JSON 取值不做二次校验：入参形状由工具 schema 把关，语义由 CLI 侧显式报错。
  assert.equal(
    buildReportsArgv('report', create, { action: 'create', definition: { name: 'x' } }).argv.at(-1),
    '{"name":"x"}',
  )
})

test('调用伴侣 CLI：走 [node, 入口] 前缀、下发官方 CLI 入口、复用 JSON 解析', async () => {
  const spawns: Spawn[] = []
  const deps = depsOf(spawns)
  const cli = new ActualCli(
    { argv: ['actual'], version: '26.10.0', origin: 'test', env: {} },
    CONFIG,
    deps,
  )
  const invoke = createEntryInvoker(cli, deps, EMPTY_TREE)
  const result = await invoke(reportEntry(), { action: 'list' }, { timeoutMs: 5_000 })
  // 替身把 spawn 收到的 args 原样回显：首位是伴侣 CLI 入口（node 的脚本参数）。
  assert.deepEqual(result, {
    ok: true,
    argv: [REPORTS_CLI, 'report', 'list', '--format', 'json'],
  })
  const spawn = spawns.at(-1)
  assert.equal(spawn?.file, process.execPath)
  assert.deepEqual(spawn?.args, [REPORTS_CLI, 'report', 'list', '--format', 'json'])
  assert.equal(spawn?.env?.[REPORTS_CLI_ENTRY_ENV], 'actual')
})

test('调用伴侣 CLI：未知 action、缺必填、参数不适用都显式报错', async () => {
  const deps = depsOf([])
  const cli = new ActualCli(
    { argv: ['actual'], version: '26.10.0', origin: 'test', env: {} },
    CONFIG,
    deps,
  )
  const invoke = createEntryInvoker(cli, deps, EMPTY_TREE)
  const entry = reportEntry()
  await assert.rejects(
    async () => await invoke(entry, { action: 'nope' }, { timeoutMs: 1_000 }),
    /未知的 action：report nope/,
  )
  await assert.rejects(
    async () => await invoke(entry, {}, { timeoutMs: 1_000 }),
    /缺少 action：report/,
  )
  await assert.rejects(
    async () => await invoke(entry, { action: 'create' }, { timeoutMs: 1_000 }),
    /缺少必填参数：definition/,
  )
  await assert.rejects(
    async () => await invoke(entry, { action: 'list', reportId: 'x' }, { timeoutMs: 1_000 }),
    /参数 reportId 不适用于 report list/,
  )
  await assert.rejects(
    async () =>
      await invoke(entry, { action: 'delete', reportId: 'x', force: 'yes' }, { timeoutMs: 1_000 }),
    /参数 force 需要布尔值/,
  )
})

test('伴侣 CLI 与官方 CLI 共用一条串行队列', async () => {
  const order: string[] = []
  const deps: CliDeps = {
    async execFile(file, args) {
      order.push(`start:${file === process.execPath ? 'reports' : 'actual'}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(`end:${file === process.execPath ? 'reports' : 'actual'}`)
      return { stdout: JSON.stringify({ ok: true, argv: args }), stderr: '', code: 0 }
    },
    async fetchJson() {
      return { ok: true, status: 200, body: {} }
    },
    env: {},
    resolveBundledCli: () => undefined,
    resolveReportsCli: () => REPORTS_CLI,
  }
  const cli = new ActualCli(
    { argv: ['actual'], version: '26.10.0', origin: 'test', env: {} },
    CONFIG,
    deps,
  )
  const invoke = createEntryInvoker(cli, deps, await accountsTree())
  const options = { timeoutMs: 5_000 }
  const familyEntry: CapabilityEntry = {
    name: 'accounts',
    description: 'x',
    inputSchema: {},
    source: 'cli',
    cli: { family: 'accounts', kind: 'subcommands', actionMap: { list: 'list' } },
  }
  await Promise.all([
    invoke(familyEntry, { action: 'list' }, options),
    invoke(reportEntry(), { action: 'list' }, options),
  ])
  // 关键性质是「不交错」：同一时刻只有一条链路在跑（顺序由入队时机决定，不作断言）。
  assert.deepEqual(
    order.map((item) => item.split(':')[1]),
    ['reports', 'reports', 'actual', 'actual'],
  )
})
