#!/usr/bin/env node
/**
 * 测试替身 CLI：以真实抓取的 help 文本模拟 `@actual-app/cli` 的可观测行为
 * （`--version` / `--help` 树 / 默认 JSON 输出），不连服务器、不落盘。
 *
 * 它让「格式一（stdio MCP 服务）」能在零网络、零真实 CLI 的前提下端到端受测。
 * 未收录的命令回落到通用最小 help，保证发现流程不会因缺 fixture 而中断。
 * @module tests/fixtures/fake-actual
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 命令行路径 → 采集到的真实 help fixture。 */
const HELP_FILES = {
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

const argv = process.argv.slice(2)

if (argv.includes('--version')) {
  process.stdout.write('26.10.0\n')
  process.exit(0)
}

const helpIndex = argv.indexOf('--help')
if (helpIndex >= 0) {
  const path = argv.slice(0, helpIndex).join(' ')
  const file = HELP_FILES[path]
  if (file !== undefined) {
    process.stdout.write(readFileSync(join(HERE, file), 'utf8'))
    process.exit(0)
  }
  const name = path === '' ? 'actual' : `actual ${path}`
  process.stdout.write(
    `Usage: ${name} [options]\n\nSynthetic command\n\nOptions:\n` +
      '  --flag <value>  Synthetic flag\n  -h, --help      display help for command\n',
  )
  process.exit(0)
}

process.stdout.write(`${JSON.stringify({ ok: true, argv })}\n`)
