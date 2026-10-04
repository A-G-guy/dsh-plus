import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { buildCatalog, computeDrift, type HelpTree, kebabToCamel } from '../src/derive.ts'
import { parseCommanderHelp } from '../src/help.ts'

/** 读取采集的 commander help fixture。 */
function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

const SYNTHETIC: HelpTree = {
  root: parseCommanderHelp(
    [
      'Usage: actual [options] [command]',
      '',
      'CLI for Actual Budget',
      '',
      'Options:',
      '  -h, --help  display help for command',
      '',
      'Commands:',
      '  demo        Demo family',
      '  reader      Read-only family',
      '  solo        Solo command',
      '  help [command]  display help for command',
    ].join('\n'),
  ),
  families: new Map([
    [
      'demo',
      parseCommanderHelp(
        [
          'Usage: actual demo [options] [command]',
          '',
          'Demo family',
          '',
          'Options:',
          '  -h, --help      display help for command',
          '',
          'Commands:',
          '  list [options]  List things',
          '  update [options] <id>  Update a thing',
          '  help [command]  display help for command',
        ].join('\n'),
      ),
    ],
    [
      'reader',
      parseCommanderHelp(
        [
          'Usage: actual reader [options] [command]',
          '',
          'Read-only family',
          '',
          'Options:',
          '  -h, --help  display help for command',
          '',
          'Commands:',
          '  list [options]  List things',
          '  help [command]  display help for command',
        ].join('\n'),
      ),
    ],
    [
      'solo',
      parseCommanderHelp(
        [
          'Usage: actual solo [options] <target>',
          '',
          'Solo command',
          '',
          'Options:',
          '  --mode <mode>  Mode (choices: "a", "b")',
          '  --force        Force it (default: false)',
          '  --file <path>  Read from file (use - for stdin)',
          '  -h, --help     display help for command',
        ].join('\n'),
      ),
    ],
  ]),
  actions: new Map([
    [
      'demo list',
      parseCommanderHelp(
        [
          'Usage: actual demo list [options]',
          '',
          'List things',
          '',
          'Options:',
          '  --limit <n>   Limit results',
          '  --shared <v>  Shared option',
          '  -h, --help    display help for command',
        ].join('\n'),
      ),
    ],
    [
      'demo update',
      parseCommanderHelp(
        [
          'Usage: actual demo update [options] <id>',
          '',
          'Update a thing',
          '',
          'Options:',
          '  --shared <v>  Shared option',
          '  --name <name>  New name',
          '  -h, --help    display help for command',
        ].join('\n'),
      ),
    ],
    [
      'reader list',
      parseCommanderHelp(
        [
          'Usage: actual reader list [options]',
          '',
          'List things',
          '',
          'Options:',
          '  --limit <n>  Limit results',
          '  -h, --help   display help for command',
        ].join('\n'),
      ),
    ],
  ]),
}

test('given a family with subcommands, when deriving, then one tool carries the action enum', () => {
  const { entries } = buildCatalog(SYNTHETIC)
  const demo = entries.find((entry) => entry.name === 'demo')
  assert.ok(demo !== undefined)
  assert.equal(demo.description, 'Demo family\nUsage: actual demo [options] [command]')
  const properties = demo.inputSchema.properties as Record<string, Record<string, unknown>>
  assert.deepEqual(properties.action?.enum, ['list', 'update'])
  assert.equal(
    properties.action?.description,
    'Operation. list: List things; update: Update a thing',
  )
  assert.deepEqual(demo.inputSchema.required, ['action'])
  assert.equal(demo.inputSchema.additionalProperties, false)
  assert.equal(demo.cli?.kind, 'subcommands')
  assert.deepEqual(demo.cli?.actionMap, { list: 'list', update: 'update' })
})

test('given a union of action options, when deriving, then subset options carry a used-by note', () => {
  const { entries } = buildCatalog(SYNTHETIC)
  const properties = entries.find((entry) => entry.name === 'demo')?.inputSchema
    .properties as Record<string, Record<string, unknown>>
  assert.equal(properties.limit?.description, 'Limit results [used by: list]')
  assert.equal(properties.name?.description, 'New name [used by: update]')
  assert.equal(properties.shared?.description, 'Shared option', '全动作共用的选项不加注记')
  assert.equal(properties.id?.description, 'Positional argument <id> [used by: update]')
  assert.equal(
    properties.id !== undefined && 'required' in properties.id,
    false,
    '位置参数不得进工具级 required（会挡住不含该参数的动作）',
  )
})

test('given a leaf family, when deriving, then positionals become required and options are typed', () => {
  const { entries } = buildCatalog(SYNTHETIC)
  const solo = entries.find((entry) => entry.name === 'solo')
  assert.ok(solo !== undefined)
  assert.deepEqual(solo.inputSchema.required, ['target'])
  assert.equal(solo.cli?.kind, 'direct')
  assert.deepEqual(solo.cli?.positionalByProp, { target: 'target' })
  const properties = solo.inputSchema.properties as Record<string, Record<string, unknown>>
  assert.deepEqual(properties.mode?.enum, ['a', 'b'])
  assert.equal(properties.force?.type, 'boolean')
  assert.equal(properties.file?.type, 'string')
})

test('given a top-level option with diverging choices, when deriving, then the enum is dropped', () => {
  const tree: HelpTree = {
    root: SYNTHETIC.root,
    families: new Map([
      [
        'demo',
        parseCommanderHelp(
          [
            'Usage: actual demo [options] [command]',
            '',
            'Demo family',
            '',
            'Options:',
            '  -h, --help  display help for command',
            '',
            'Commands:',
            '  one [options]  First',
            '  two [options]  Second',
            '  help [command]  display help for command',
          ].join('\n'),
        ),
      ],
    ]),
    actions: new Map([
      [
        'demo one',
        parseCommanderHelp(
          'Usage: actual demo one [options]\n\nFirst\n\nOptions:\n  --kind <k>  Kind (choices: "a")\n  -h, --help  display help for command\n',
        ),
      ],
      [
        'demo two',
        parseCommanderHelp(
          'Usage: actual demo two [options]\n\nSecond\n\nOptions:\n  --kind <k>  Kind (choices: "b")\n  -h, --help  display help for command\n',
        ),
      ],
    ]),
  }
  const properties = buildCatalog(tree).entries[0]?.inputSchema.properties as Record<
    string,
    Record<string, unknown>
  >
  assert.equal(properties.kind?.enum, undefined, '取值不一致时不得收窄为 enum')
  assert.equal(properties.kind?.type, 'string')
})

test('given read-only actions, when deriving, then only an all-read tool is annotated read-only', () => {
  const { entries } = buildCatalog(SYNTHETIC, { readActions: ['list'] })
  assert.equal(entries.find((entry) => entry.name === 'reader')?.readOnly, true)
  assert.equal(entries.find((entry) => entry.name === 'demo')?.readOnly, undefined)
})

test('given a name prefix, when deriving, then tool names are prefixed', () => {
  const { entries } = buildCatalog(SYNTHETIC, { namePrefix: 'actual_' })
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['actual_demo', 'actual_reader', 'actual_solo'],
  )
})

test('given a missing action help, when deriving, then a diagnostic is reported', () => {
  const listHelp = SYNTHETIC.actions.get('demo list')
  const tree: HelpTree = {
    ...SYNTHETIC,
    actions: new Map(listHelp === undefined ? [] : [['demo list', listHelp]]),
  }
  const { warnings } = buildCatalog(tree)
  assert.ok(
    warnings.some((warning) => warning.includes('demo update')),
    `应报告缺失的动作 help，实际：${warnings.join(' / ')}`,
  )
})

test('given real accounts help, when deriving, then the family tool matches the CLI shape', async () => {
  const names = [
    'accounts',
    'accounts list',
    'accounts create',
    'accounts update',
    'accounts close',
    'accounts balance',
  ]
  const tree: HelpTree = {
    root: parseCommanderHelp(await fixture('root-help.txt')),
    families: new Map([['accounts', parseCommanderHelp(await fixture('accounts-help.txt'))]]),
    actions: new Map([
      ['accounts list', parseCommanderHelp(await fixture('accounts-list-help.txt'))],
      ['accounts create', parseCommanderHelp(await fixture('accounts-create-help.txt'))],
      ['accounts update', parseCommanderHelp(await fixture('accounts-update-help.txt'))],
      ['accounts close', parseCommanderHelp(await fixture('accounts-close-help.txt'))],
      ['accounts balance', parseCommanderHelp(await fixture('accounts-balance-help.txt'))],
    ]),
  }
  const { entries, warnings } = buildCatalog(tree, { namePrefix: 'actual_' })
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['actual_accounts'],
  )
  assert.deepEqual(
    warnings.filter((warning) => warning.startsWith('accounts')).map((w) => w.split(':')[0]),
    ['accounts reopen', 'accounts delete'],
  )
  const properties = entries[0]?.inputSchema.properties as Record<string, Record<string, unknown>>
  assert.deepEqual(properties.action?.enum, [
    'list',
    'create',
    'update',
    'close',
    'reopen',
    'delete',
    'balance',
  ])
  assert.equal(properties.includeClosed?.description, 'Include closed accounts [used by: list]')
  assert.equal(
    properties.id?.description,
    'Positional argument <id> [used by: update, close, reopen, delete, balance]',
  )
  assert.equal(properties.cutoff?.description, 'Cutoff date (YYYY-MM-DD) [used by: balance]')
  assert.equal(entries[0]?.readOnly, undefined, 'accounts 含写动作，不得标为只读')
  assert.ok(names.length > 0)
})

test('given the sync leaf command, when deriving, then it is a direct tool classified as write', async () => {
  const tree: HelpTree = {
    root: parseCommanderHelp(await fixture('root-help.txt')),
    families: new Map([['sync', parseCommanderHelp(await fixture('sync-help.txt'))]]),
    actions: new Map(),
  }
  const sync = buildCatalog(tree).entries[0]
  assert.ok(sync !== undefined)
  assert.equal(sync.cli?.kind, 'direct')
  assert.deepEqual(sync.inputSchema.required, undefined)
  assert.equal(sync.readOnly, undefined, 'sync 管理本地缓存，属写侧')
})

test('given the query family, when deriving, then field positionals and choices are captured', async () => {
  const tree: HelpTree = {
    root: parseCommanderHelp(await fixture('root-help.txt')),
    families: new Map([['query', parseCommanderHelp(await fixture('query-help.txt'))]]),
    actions: new Map([
      ['query run', parseCommanderHelp(await fixture('query-run-help.txt'))],
      ['query fields', parseCommanderHelp(await fixture('query-fields-help.txt'))],
    ]),
  }
  const query = buildCatalog(tree).entries[0]
  assert.ok(query !== undefined)
  assert.equal(query.readOnly, true, 'query 全部动作只读')
  const properties = query.inputSchema.properties as Record<string, Record<string, unknown>>
  // `query run --table` 与 `query fields <table>` 同名：按属性名合并，两条语义都保留。
  assert.equal(
    properties.table?.description,
    'Table to query (use "actual query tables" to list available tables) | ' +
      'Positional argument <table> [used by: run, fields]',
  )
  assert.equal(properties.count?.type, 'boolean')
  assert.equal(properties.limit?.description, 'Limit number of results [used by: run]')
})

test('given mcp entries and a cli help tree, when computing drift, then set differences are reported', () => {
  const families = new Map([
    ['a', parseCommanderHelp('Usage: actual a [options]\n\nA\n')],
    ['b', parseCommanderHelp('Usage: actual b [options]\n\nB\n')],
  ])
  const entries = [
    {
      name: 'a',
      description: '',
      inputSchema: {},
      source: 'mcp' as const,
    },
    { name: 'c', description: '', inputSchema: {}, source: 'mcp' as const },
  ]
  assert.deepEqual(computeDrift(entries, families, ['c']), {
    mcpOnly: ['c'],
    cliOnly: ['b'],
    unmapped: ['c'],
  })
})

test('given kebab names, when converting, then camelCase properties are produced', () => {
  assert.equal(kebabToCamel('order-by'), 'orderBy')
  assert.equal(kebabToCamel('no-cache'), 'noCache')
  assert.equal(kebabToCamel('include-closed'), 'includeClosed')
  assert.equal(kebabToCamel('list'), 'list')
})
