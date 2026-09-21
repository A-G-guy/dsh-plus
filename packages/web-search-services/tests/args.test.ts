import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSearchArgv, FALLBACK_MAX_RESULTS } from '../src/args.ts'
import { Config } from '../src/config.ts'

const baseConfig = Config({})

test('given query and config, when argv built, then priority maps to --service order', () => {
  const cfg = Config({ priority: ['exa', 'tavily'] })
  const argv = buildSearchArgv(cfg, { query: 'dsh 插件机制' })
  assert.deepEqual(argv, [
    'search',
    '--query',
    'dsh 插件机制',
    '--service',
    'exa,tavily',
    '--max-results',
    String(FALLBACK_MAX_RESULTS),
  ])
})

test('given maxResults in request, when argv built, then request value wins', () => {
  const argv = buildSearchArgv(baseConfig, { query: 'q', maxResults: 3 })
  assert.equal(argv.at(-1), '3')
})

test('given blank query, when argv built, then rejected before spawn', () => {
  assert.throws(() => buildSearchArgv(baseConfig, { query: '   ' }), /non-empty/)
})
