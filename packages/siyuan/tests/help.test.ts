import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { parseKernelHelp, parseUsage } from '../src/help.ts'

/** 读取采集的 cobra help fixture（生产数据无关：纯产品元数据）。 */
function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

test('given kernel document help, when parsing, then subcommands and short description are captured', async () => {
  const help = parseKernelHelp(await fixture('kernel-document-help.txt'))
  assert.equal(help.short, 'Manage documents')
  assert.deepEqual(
    help.subcommands.map((sub) => sub.name),
    ['create', 'duplicate', 'get', 'info', 'list', 'move', 'remove', 'rename', 'search'],
  )
  assert.deepEqual(help.positionals, [])
  // 家族级本地 flag 仅 -h（被剔除）；Global Flags 不入表
  assert.deepEqual(help.flags, [])
})

test('given kernel sql help, when parsing, then positional and typed local flags are captured', async () => {
  const help = parseKernelHelp(await fixture('kernel-sql-help.txt'))
  assert.deepEqual(help.positionals, ['statement'])
  const limit = help.flags.find((flag) => flag.name === 'limit')
  assert.ok(limit !== undefined)
  assert.equal(limit.type, 'int')
  assert.equal(limit.shorthand, 'l')
  assert.equal(limit.required, false)
  assert.equal(
    help.flags.some((flag) => flag.name === 'format'),
    false,
    'Global Flags 必须被排除',
  )
  assert.equal(
    help.flags.some((flag) => flag.name === 'help'),
    false,
    '--help 必须被剔除',
  )
})

test('given kernel search help, when parsing, then stringArray and bool flags keep descriptions', async () => {
  const help = parseKernelHelp(await fixture('kernel-search-help.txt'))
  const notebook = help.flags.find((flag) => flag.name === 'notebook')
  assert.ok(notebook !== undefined)
  assert.equal(notebook.type, 'stringArray')
  const asset = help.flags.find((flag) => flag.name === 'asset')
  assert.ok(asset !== undefined)
  assert.equal(asset.type, 'bool')
  assert.match(asset.description, /search asset file contents/)
  assert.deepEqual(help.positionals, ['query'])
})

test('given a usage line with required flags, when parsing, then required flags and positionals are extracted', () => {
  const parsed = parseUsage('kernel document create --notebook <id> --title <title> [flags]')
  assert.deepEqual([...parsed.requiredFlags].sort(), ['notebook', 'title'])
  assert.deepEqual(parsed.positionals, [])
  const direct = parseUsage('kernel sql <statement> [flags]')
  assert.deepEqual(direct.positionals, ['statement'])
  assert.equal(direct.requiredFlags.size, 0)
})
