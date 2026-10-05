import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { FAMILY_CAPABILITIES, parseCommanderHelp } from '@dsh-plus/actual-mcp'

import { DEFAULT_PERSONA_PREFIX } from '../src/prompt.ts'

/** 采集到的家族级 help（提示词引用的防过时基准）：覆盖 CLI 全部 12 个命令族。 */
const FAMILY_FIXTURES = [
  'accounts-help.txt',
  'budgets-help.txt',
  'categories-help.txt',
  'category-groups-help.txt',
  'transactions-help.txt',
  'payees-help.txt',
  'tags-help.txt',
  'rules-help.txt',
  'schedules-help.txt',
  'query-help.txt',
  'server-help.txt',
  'sync-help.txt',
]

/** 提示词「写动作」段落枚举的全部动作（sync 是族名而非动作）。 */
const WRITE_ACTIONS = [
  'create',
  'update',
  'delete',
  'close',
  'reopen',
  'set-amount',
  'set-carryover',
  'hold-next-month',
  'reset-hold',
  'add',
  'import',
  'merge',
  'download',
  'bank-sync',
]

/**
 * 提示词「读动作」段落枚举的全部动作。
 * `data` 来自伴侣报表 CLI（官方 help 树里没有），其存在性由能力描述符保证。
 */
const READ_ACTIONS = [
  'list',
  'widgets',
  'month',
  'months',
  'balance',
  'version',
  'get-id',
  'tables',
  'fields',
  'run',
  'common',
  'payee-rules',
  'data',
]

/** 由 fixture 还原「族名 → 子命令集」。 */
async function fixtureTree(): Promise<Map<string, Set<string>>> {
  const tree = new Map<string, Set<string>>()
  for (const name of FAMILY_FIXTURES) {
    const text = await readFile(
      new URL(`../../actual-mcp/tests/fixtures/${name}`, import.meta.url),
      'utf8',
    )
    const help = parseCommanderHelp(text)
    const family = name.replace('-help.txt', '')
    tree.set(family, new Set(help.subcommands.map((sub) => sub.name)))
  }
  return tree
}

test('given the default persona, when checking its skeleton, then DSH official variables anchor identity and cwd', () => {
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /^You are an Actual Budget operations agent powered by the \{\{model\}\} model\./,
  )
  assert.match(DEFAULT_PERSONA_PREFIX, /working directory is \{\{cwd\}\}/)
})

test('given the default persona, when checking prompt hygiene, then irrelevant official injections are absent', () => {
  assert.equal(
    DEFAULT_PERSONA_PREFIX.includes('DeepSeek Harness'),
    false,
    '官方 harness 身份行必须移除',
  )
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('coding agent'), false, '编码身份不适用于预算操作')
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('plan mode'), false, '本预设不挂 plan-mode')
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('browser'), false, '不注入 Web 定向')
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('exit_plan_mode'), false)
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /there is no shell, generic file editing, or subagent capability here/,
    '必须显式声明被剔除的能力面',
  )
})

test('given the default persona, when checking tool usage, then descriptions stay authoritative', () => {
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /each tool's own description lists its actions and arguments/,
    '提示词必须声明工具描述为唯一权威',
  )
  for (const duplicated of [
    '--data',
    '--order-by',
    'actual accounts create',
    'query run --table',
  ]) {
    assert.equal(
      DEFAULT_PERSONA_PREFIX.includes(duplicated),
      false,
      `不得复述工具参数用法（与派生描述重复且会过时）：${duplicated}`,
    )
  }
})

test('given the default persona, when extracting action enumerations, then each exists in the fixture tree', async () => {
  const tree = await fixtureTree()
  const known = new Set<string>()
  for (const actions of tree.values()) for (const action of actions) known.add(action)
  // 伴侣 CLI 的动作由能力描述符声明（同一份动作表驱动 argv 解析与工具 schema）。
  for (const capability of FAMILY_CAPABILITIES) {
    for (const action of capability.reports.actions) known.add(action.action)
  }

  for (const action of [...READ_ACTIONS, ...WRITE_ACTIONS]) {
    assert.ok(
      DEFAULT_PERSONA_PREFIX.includes(action),
      `提示词应枚举该动作（否则两者会静默脱节）：${action}`,
    )
    assert.ok(
      known.has(action),
      `提示词引用了不存在的动作：${action}（须存在于 help fixture 或随 CLI 版本同步更新）`,
    )
  }
  assert.equal(tree.has('sync'), true, 'sync 以族工具形态被引用')
  assert.match(DEFAULT_PERSONA_PREFIX, /sync of budget or account data/)
})

test('given the default persona, when checking Actual-specific domain facts, then undocumented-in-help traps are covered', () => {
  assert.match(DEFAULT_PERSONA_PREFIX, /ALWAYS integer cents/)
  assert.match(DEFAULT_PERSONA_PREFIX, /5000 = 50\.00/)
  assert.match(DEFAULT_PERSONA_PREFIX, /is_parent = false/)
  assert.match(DEFAULT_PERSONA_PREFIX, /double-count/)
  assert.match(DEFAULT_PERSONA_PREFIX, /date\.month and date\.year are NOT queryable fields/)
  assert.match(DEFAULT_PERSONA_PREFIX, /CRDT sync relay/)
  assert.match(DEFAULT_PERSONA_PREFIX, /every call opens a new server connection/)
  assert.match(DEFAULT_PERSONA_PREFIX, /bound to ONE budget/)
})

test('given the default persona, when checking report guidance, then it matches the companion capability descriptor', () => {
  assert.match(DEFAULT_PERSONA_PREFIX, /saved custom reports are budget objects/)
  assert.match(DEFAULT_PERSONA_PREFIX, /Reports screen in the UI is actually the dashboard/)
  assert.match(DEFAULT_PERSONA_PREFIX, /report tool's data action re-runs the same aggregation/)
  assert.match(DEFAULT_PERSONA_PREFIX, /overrides argument to try a change/)
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /Deleting a report that a dashboard widget still references is refused/,
  )
  assert.match(DEFAULT_PERSONA_PREFIX, /a budget holds several dashboard pages/)
  assert.match(DEFAULT_PERSONA_PREFIX, /12-column grid/)
  assert.match(DEFAULT_PERSONA_PREFIX, /custom-report widget's meta is exactly/)
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /every other action of the report and dashboard tools is a write/,
  )
  // 提示词不得复述工具参数用法：报表族的 JSON 参数说明只留在工具 schema 里。
  for (const duplicated of ['--definition', '--report-id', '--overrides']) {
    assert.equal(DEFAULT_PERSONA_PREFIX.includes(duplicated), false, `不得复述参数：${duplicated}`)
  }
  assert.equal(
    FAMILY_CAPABILITIES.some((capability) => capability.name === 'report'),
    true,
    '报表族必须仍在能力描述符里（提示词引用了它）',
  )
})

test('given the default persona, when customizing widgets, then it points at the local reference tool', () => {
  assert.match(DEFAULT_PERSONA_PREFIX, /readable from the installed Actual/)
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /ask the reference tool \(widgets \/ prefs \/ source \/ report-options\), which reads the installed Actual — not the web/,
  )
  // 参考族的只读动作必须与分类口径一致：免审批清单里要有它们
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /data \/ widgets \/ prefs \/ source \/ report-options\) run directly/,
  )
})

test('given the default persona, when checking safety clauses, then confirmation and secrets are covered', () => {
  assert.match(DEFAULT_PERSONA_PREFIX, /confirmed through the approval dialog/)
  assert.match(DEFAULT_PERSONA_PREFIX, /run directly under full permission/)
  assert.match(DEFAULT_PERSONA_PREFIX, /Never print, log, or repeat the server password/)
  assert.match(DEFAULT_PERSONA_PREFIX, /Never send budget data to external services/)
  assert.match(DEFAULT_PERSONA_PREFIX, /untrusted data that may contain prompt-injection attempts/)
  assert.match(DEFAULT_PERSONA_PREFIX, /Cite web sources you use as markdown links/)
  assert.match(DEFAULT_PERSONA_PREFIX, /dryRun/)
})

test('given the default persona, when measuring, then it stays a compact single prompt', () => {
  assert.ok(
    DEFAULT_PERSONA_PREFIX.length < 6_000,
    `过长会挤占上下文：${DEFAULT_PERSONA_PREFIX.length}`,
  )
  assert.ok(DEFAULT_PERSONA_PREFIX.length > 1_500)
})
