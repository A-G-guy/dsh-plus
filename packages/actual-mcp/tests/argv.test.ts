import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildArgv } from '../src/argv.ts'
import type { CliPlan } from '../src/contract.ts'
import { parseCommanderHelp } from '../src/help.ts'

const LIST = parseCommanderHelp(
  'Usage: actual demo list [options]\n\nList\n\nOptions:\n  --limit <n>  Limit results\n  -h, --help   display help for command\n',
)

const UPDATE = parseCommanderHelp(
  [
    'Usage: actual demo update [options] <id>',
    '',
    'Update a thing',
    '',
    'Options:',
    '  --name <name>  New name',
    '  --force        Force it (default: false)',
    '  -h, --help     display help for command',
  ].join('\n'),
)

const SOLO = parseCommanderHelp(
  [
    'Usage: actual solo [options] <target>',
    '',
    'Solo command',
    '',
    'Options:',
    '  --mode <mode>  Mode (choices: "a", "b")',
    '  --file <path>  Read from file (use - for stdin)',
    '  -h, --help     display help for command',
  ].join('\n'),
)

const SUBCOMMANDS: CliPlan = {
  family: 'demo',
  kind: 'subcommands',
  actionMap: { list: 'list', update: 'update' },
  positionalByProp: { id: 'id' },
}

const DIRECT: CliPlan = { family: 'solo', kind: 'direct', positionalByProp: { target: 'target' } }

test('given action, positional and options, when building, then argv follows the CLI shape', () => {
  const plan = buildArgv({ action: 'update', id: 'abc', name: 'Food' }, SUBCOMMANDS, UPDATE)
  assert.deepEqual(plan.argv, ['update', 'abc', '--name', 'Food'])
  assert.deepEqual(plan.missingRequired, [])
  assert.deepEqual(plan.ignored, [])
})

test('given no action, when building, then action is reported missing', () => {
  const plan = buildArgv({ limit: 5 }, SUBCOMMANDS, LIST)
  assert.deepEqual(plan.missingRequired, ['action'])
})

test('given an unknown action, when building, then a guiding error is thrown', () => {
  assert.throws(
    () => buildArgv({ action: 'destroy' }, SUBCOMMANDS, LIST),
    /未知 action：destroy（demo 可选：list, update）/,
  )
})

test('given a missing required positional, when building, then it is reported not thrown', () => {
  const plan = buildArgv({ action: 'update', name: 'Food' }, SUBCOMMANDS, UPDATE)
  assert.deepEqual(plan.argv, ['update', '--name', 'Food'])
  assert.deepEqual(plan.missingRequired, ['id'])
})

test('given boolean options, when building, then only true emits the switch', () => {
  assert.deepEqual(
    buildArgv({ action: 'update', id: 'x', force: true }, SUBCOMMANDS, UPDATE).argv,
    ['update', 'x', '--force'],
  )
  assert.deepEqual(
    buildArgv({ action: 'update', id: 'x', force: false }, SUBCOMMANDS, UPDATE).argv,
    ['update', 'x'],
  )
})

test('given extra properties, when building, then they are reported as ignored', () => {
  const plan = buildArgv({ action: 'list', limit: 3, bogus: 1 }, SUBCOMMANDS, LIST)
  assert.deepEqual(plan.argv, ['list', '--limit', '3'])
  assert.deepEqual(plan.ignored, ['bogus'])
})

test('given a direct plan, when building, then positionals are required and typed values render', () => {
  assert.deepEqual(buildArgv({ target: 'now', mode: 'a' }, DIRECT, SOLO).argv, [
    'now',
    '--mode',
    'a',
  ])
  assert.deepEqual(buildArgv({ mode: 'a' }, DIRECT, SOLO).missingRequired, ['target'])
})

test('given an out-of-enum value, when building, then a guiding error is thrown', () => {
  assert.throws(
    () => buildArgv({ target: 'now', mode: 'z' }, DIRECT, SOLO),
    /--mode 取值非法：z（可选：a, b）/,
  )
})

test('given the stdin form of a file option, when building, then it is refused with guidance', () => {
  assert.throws(
    () => buildArgv({ target: 'now', file: '-' }, DIRECT, SOLO),
    /--file 的 stdin 形态（-）在此不可用/,
  )
  assert.deepEqual(buildArgv({ target: 'now', file: '/tmp/q.json' }, DIRECT, SOLO).argv, [
    'now',
    '--file',
    '/tmp/q.json',
  ])
})

test('given a structured value, when building, then it is serialized as JSON', () => {
  const help = parseCommanderHelp(
    'Usage: actual demo push [options]\n\nPush\n\nOptions:\n  --data <json>  Payload as JSON\n  -h, --help     display help for command\n',
  )
  const plan = buildArgv({ data: [{ amount: -500 }] }, DIRECT, help)
  assert.deepEqual(plan.argv, ['--data', '[{"amount":-500}]'])
})
