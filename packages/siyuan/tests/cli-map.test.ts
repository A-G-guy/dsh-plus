import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parseRootFamilies } from '../src/cli.ts'
import {
  buildArgv,
  buildCliEntry,
  buildCliPlan,
  camelToKebab,
  computeDrift,
  kebabToCamel,
  resolveCliAction,
} from '../src/cli-map.ts'
import type { CapabilityEntry } from '../src/contract.ts'
import { parseKernelHelp } from '../src/help.ts'

/** 从录制的 tools/list fixture 取一条 MCP 能力。 */
async function mcpEntry(name: string): Promise<CapabilityEntry> {
  const raw = JSON.parse(
    await readFile(new URL('./fixtures/mcp-tools-list.json', import.meta.url), 'utf8'),
  ) as {
    result: { tools: CapabilityEntry[] }
  }
  const tool = raw.result.tools.find((candidate) => candidate.name === name)
  assert.ok(tool !== undefined, `fixture 应含工具 ${name}`)
  return { ...tool, source: 'mcp' }
}

function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

const CREATE_HELP = `Create a document

Usage:
  kernel document create --notebook <id> --title <title> [flags]

Flags:
  -h, --help              help for create
      --markdown string   initial markdown content
      --notebook string   notebook ID
      --path string       parent document path (default /)
      --title string      document title

Global Flags:
      --dry-run            dry run mode
`

test('given MCP actions and CLI subcommands, when resolving, then aliases and kebab conversions map correctly', async () => {
  const documentHelp = parseKernelHelp(await fixture('kernel-document-help.txt'))
  assert.equal(
    resolveCliAction('document', 'delete', documentHelp),
    'remove',
    '显式差异表 delete → remove',
  )
  assert.equal(resolveCliAction('document', 'search_docs', documentHelp), 'search')
  assert.equal(resolveCliAction('document', 'create', documentHelp), 'create')
  const synthetic = parseKernelHelp(`X

Usage:
  kernel notebook [command]

Available Commands:
  set-icon    Set icon
`)
  assert.equal(
    resolveCliAction('notebook', 'set_icon', synthetic),
    'set-icon',
    'snake → kebab 自动转换',
  )
  assert.equal(resolveCliAction('notebook', 'nope', synthetic), undefined)
  assert.equal(camelToKebab('pageSize'), 'page-size')
  assert.equal(kebabToCamel('page-size'), 'pageSize')
})

test('given the document MCP entry and CLI help, when building the fallback plan, then every action maps', async () => {
  const entry = await mcpEntry('document')
  const plan = buildCliPlan(entry, parseKernelHelp(await fixture('kernel-document-help.txt')))
  assert.ok(plan !== undefined)
  assert.equal(plan.kind, 'subcommands')
  assert.equal(plan.actionMap?.delete, 'remove')
  assert.equal(plan.actionMap?.search_docs, 'search')
  assert.equal(plan.actionMap?.duplicate, 'duplicate')
})

test('given direct families, when building the plan, then sql maps positionals while search stays unmapped', async () => {
  const sql = await mcpEntry('sql')
  const sqlPlan = buildCliPlan(sql, parseKernelHelp(await fixture('kernel-sql-help.txt')))
  assert.ok(sqlPlan !== undefined)
  assert.equal(sqlPlan.kind, 'direct')
  assert.deepEqual(sqlPlan.positionalByProp, { stmt: 'statement' })

  const search = await mcpEntry('search')
  const searchPlan = buildCliPlan(search, parseKernelHelp(await fixture('kernel-search-help.txt')))
  assert.equal(searchPlan, undefined, 'direct 家族多 action（fulltext/semantic/…）无法经子命令表达')
})

test('given document help and one action help, when deriving the CLI-native tool, then union flags carry required annotations', async () => {
  const familyHelp = parseKernelHelp(await fixture('kernel-document-help.txt'))
  const actionHelps = new Map([['document create', parseKernelHelp(CREATE_HELP)]])
  const entry = buildCliEntry('document', familyHelp, actionHelps)
  assert.equal(entry.source, 'cli')
  assert.equal(entry.cli?.kind, 'subcommands')
  const schema = entry.inputSchema as {
    properties: Record<string, { type?: string; description?: string; enum?: string[] }>
    required?: string[]
    additionalProperties: boolean
  }
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, ['action'])
  assert.deepEqual(
    schema.properties.action?.enum,
    familyHelp.subcommands.map((sub) => sub.name),
  )
  assert.match(schema.properties.notebook?.description ?? '', /\[required for: create\]/)
  assert.match(entry.description, /Manage documents/)
})

test('given model args and an invocation help, when building argv, then flags render typed and positionals keep order', () => {
  const plan = { family: 'document', kind: 'subcommands' as const, actionMap: { create: 'create' } }
  const invHelp = parseKernelHelp(CREATE_HELP)
  const built = buildArgv(
    { action: 'create', notebook: '20240101000000-abc1234', title: 'T', path: '/' },
    plan,
    invHelp,
  )
  assert.deepEqual(built.missingRequired, [])
  assert.deepEqual(built.argv, [
    'create',
    '--notebook',
    '20240101000000-abc1234',
    '--path',
    '/',
    '--title',
    'T',
  ])
  assert.deepEqual(built.ignored, [])

  const missing = buildArgv({ action: 'create', notebook: 'x' }, plan, invHelp)
  assert.deepEqual(missing.missingRequired, ['title'])
  const badAction = buildArgv({ action: 'boom' }, plan, invHelp)
  assert.deepEqual(
    badAction.missingRequired,
    ['action', 'notebook', 'title'],
    'action 与必选 flag 一并缺失',
  )
})

test('given a direct plan with typed flags, when building argv, then bool/int/stringArray render cobra style', () => {
  const help = parseKernelHelp(`Search

Usage:
  kernel search <query> [flags]

Flags:
      --asset                  asset mode
  -m, --method int             method
  -n, --notebook stringArray   notebooks
`)
  const plan = { family: 'search', kind: 'direct' as const, positionalByProp: { query: 'query' } }
  const built = buildArgv(
    { query: 'kw', asset: true, method: 3, notebook: ['a', 'b'], loose: 'dropped' },
    plan,
    help,
  )
  assert.deepEqual(built.missingRequired, [])
  assert.deepEqual(built.argv, [
    'kw',
    '--asset',
    '--method',
    '3',
    '--notebook',
    'a',
    '--notebook',
    'b',
  ])
  assert.deepEqual(built.ignored, ['loose'])
})

test('given mixed sources, when computing drift, then mcp-only and cli-only sets are reported sorted', async () => {
  const document = await mcpEntry('document')
  const bazaar = await mcpEntry('bazaar')
  const helps = new Map([
    ['document', parseKernelHelp(await fixture('kernel-document-help.txt'))],
    ['sql', parseKernelHelp(await fixture('kernel-sql-help.txt'))],
  ])
  const drift = computeDrift([document, bazaar], helps, ['search'])
  assert.deepEqual(drift.mcpOnly, ['bazaar'])
  assert.deepEqual(drift.cliOnly, ['sql'])
  assert.deepEqual(drift.unmapped, ['search'])
})

test('given the root help fixture, when parsing families, then server-side commands are excluded', async () => {
  const families = parseRootFamilies(await fixture('kernel-help.txt'))
  assert.ok(families.includes('document'))
  assert.ok(families.includes('sql'))
  assert.equal(families.includes('serve'), false)
  assert.equal(families.includes('completion'), false)
  assert.equal(families.includes('help'), false)
})
