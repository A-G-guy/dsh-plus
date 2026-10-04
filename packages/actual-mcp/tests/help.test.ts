import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { parseCommanderHelp, parseUsagePositionals } from '../src/help.ts'

/** 读取采集的 commander help fixture（真实 CLI 输出，纯产品元数据）。 */
function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

test('given root help, when parsing, then the 12 command families are captured without help', async () => {
  const help = parseCommanderHelp(await fixture('root-help.txt'))
  assert.equal(help.usage, 'actual [options] [command]')
  assert.equal(help.short, 'CLI for Actual Budget')
  assert.deepEqual(
    help.subcommands.map((sub) => sub.name),
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
  assert.equal(
    help.subcommands.some((sub) => sub.name === 'help'),
    false,
    'help 子命令必须被剔除',
  )
})

test('given root help, when parsing options, then global options exclude help and version', async () => {
  const help = parseCommanderHelp(await fixture('root-help.txt'))
  assert.deepEqual(
    help.options.map((option) => option.name),
    [
      'server-url',
      'password',
      'session-token',
      'sync-id',
      'data-dir',
      'encryption-password',
      'cache-ttl',
      'refresh',
      'no-cache',
      'lock-timeout',
      'no-lock',
      'format',
      'verbose',
    ],
  )
  assert.equal(
    help.options.some((option) => option.name === 'help' || option.name === 'version'),
    false,
    '-h/--help 与 -V/--version 必须被剔除',
  )
})

test('given a wrapped option description, when parsing, then continuation lines are rejoined', async () => {
  const help = parseCommanderHelp(await fixture('root-help.txt'))
  const encryption = help.options.find((option) => option.name === 'encryption-password')
  assert.ok(encryption !== undefined)
  assert.equal(encryption.value, 'password')
  assert.equal(encryption.description, 'E2E encryption password (env: ACTUAL_ENCRYPTION_PASSWORD)')
  assert.equal(encryption.stdin, false)
})

test('given a choices option, when parsing, then enum values and default are split out', async () => {
  const help = parseCommanderHelp(await fixture('root-help.txt'))
  const format = help.options.find((option) => option.name === 'format')
  assert.ok(format !== undefined)
  assert.deepEqual(format.choices, ['json', 'table', 'csv'])
  assert.equal(format.default, '"json"')
  assert.equal(format.description, 'Output format: json, table, csv')
})

test('given boolean options, when parsing, then no value placeholder is recorded', async () => {
  const help = parseCommanderHelp(await fixture('root-help.txt'))
  for (const name of ['refresh', 'no-cache', 'no-lock', 'verbose']) {
    const option = help.options.find((candidate) => candidate.name === name)
    assert.ok(option !== undefined, `${name} 必须被解析`)
    assert.equal(option.value, undefined, `${name} 应为布尔开关`)
  }
})

test('given family help, when parsing, then subcommands carry their own positionals', async () => {
  const help = parseCommanderHelp(await fixture('accounts-help.txt'))
  assert.equal(help.short, 'Manage accounts')
  assert.deepEqual(
    help.subcommands.map((sub) => [sub.name, sub.positionals]),
    [
      ['list', []],
      ['create', []],
      ['update', ['id']],
      ['close', ['id']],
      ['reopen', ['id']],
      ['delete', ['id']],
      ['balance', ['id']],
    ],
  )
  assert.equal(help.subcommands[3]?.short, 'Close an account')
  assert.deepEqual(help.options, [], '家族级仅 -h，应被剔除')
})

test('given an action help, when parsing, then usage positionals and option defaults are captured', async () => {
  const create = parseCommanderHelp(await fixture('accounts-create-help.txt'))
  assert.equal(create.usage, 'actual accounts create [options]')
  assert.deepEqual(create.positionals, [])
  const name = create.options.find((option) => option.name === 'name')
  assert.ok(name !== undefined)
  assert.equal(name.value, 'name')
  assert.equal(name.description, 'Account name')

  const update = parseCommanderHelp(await fixture('accounts-update-help.txt'))
  assert.equal(update.usage, 'actual accounts update [options] <id>')
  assert.deepEqual(update.positionals, ['id'])
})

test('given an option with choices and a wrapped description, when parsing, then both survive', async () => {
  const help = parseCommanderHelp(await fixture('server-get-id-help.txt'))
  const type = help.options.find((option) => option.name === 'type')
  assert.ok(type !== undefined)
  assert.deepEqual(type.choices, ['accounts', 'categories', 'payees', 'schedules'])
  assert.equal(type.description, 'Entity type')
  assert.equal(help.options.find((option) => option.name === 'name')?.description, 'Entity name')
})

test('given a leaf command help, when parsing, then trailing after-text is not parsed as options', async () => {
  const help = parseCommanderHelp(await fixture('query-run-help.txt'))
  assert.equal(help.short, 'Execute an AQL query')
  assert.deepEqual(help.subcommands, [])
  assert.deepEqual(
    help.options.map((option) => option.name),
    [
      'table',
      'select',
      'filter',
      'where',
      'order-by',
      'limit',
      'offset',
      'last',
      'count',
      'group-by',
      'file',
    ],
  )
  const file = help.options.find((option) => option.name === 'file')
  assert.ok(file !== undefined)
  assert.equal(file.stdin, true, '--file 的 `-` 形态必须被标为 stdin')
  const count = help.options.find((option) => option.name === 'count')
  assert.equal(count?.value, undefined, '--count 是布尔开关')
})

test('given the sync leaf command, when parsing, then it has options but no subcommands', async () => {
  const help = parseCommanderHelp(await fixture('sync-help.txt'))
  assert.deepEqual(help.subcommands, [])
  assert.deepEqual(
    help.options.map((option) => [option.name, option.description]),
    [
      ['status', 'Print cache status without syncing'],
      ['clear', 'Delete the local cache; next command re-downloads'],
    ],
  )
})

test('given a usage line, when parsing positionals, then commander placeholders are skipped', () => {
  assert.deepEqual(parseUsagePositionals('actual [options] [command]'), {
    required: [],
    optional: [],
  })
  assert.deepEqual(parseUsagePositionals('actual accounts update [options] <id>'), {
    required: ['id'],
    optional: [],
  })
  assert.deepEqual(parseUsagePositionals('actual query fields <table>'), {
    required: ['table'],
    optional: [],
  })
})
