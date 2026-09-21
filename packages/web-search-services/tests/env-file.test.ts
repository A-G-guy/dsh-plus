import assert from 'node:assert/strict'
import { test } from 'node:test'

import { expandHome, loadEnvFile, parseEnvText } from '../src/env-file.ts'

test('given env text with comments/blanks/quotes, when parsed, then only valid pairs kept', () => {
  const text = [
    '# Search Services skill API keys',
    '',
    'export CONTEXT7_API_KEY=ctx7-123',
    'export QUOTED="hello world"',
    "export SINGLE='single quoted'",
    'PLAIN=without-export',
    'export MALFORMED',
    'export 1BAD=no-leading-digit',
    'export NO_VALUE=',
  ].join('\n')
  const env = parseEnvText(text)
  assert.equal(env.CONTEXT7_API_KEY, 'ctx7-123')
  assert.equal(env.QUOTED, 'hello world')
  assert.equal(env.SINGLE, 'single quoted')
  assert.equal(env.PLAIN, 'without-export')
  assert.equal(env.MALFORMED, undefined)
  assert.equal(env['1BAD'], undefined)
  assert.equal(env.NO_VALUE, '')
})

test('given missing env file, when loaded, then empty table instead of throw', () => {
  assert.deepEqual(loadEnvFile('/tmp/definitely-not-exist-web-search-services.env'), {})
  assert.deepEqual(loadEnvFile(''), {})
})

test('given home-relative paths, when expanded, then tilde resolves without shell', () => {
  assert.equal(expandHome('~'), process.env.HOME)
  assert.equal(expandHome('~/x/y.env'), `${process.env.HOME}/x/y.env`)
  assert.equal(expandHome('/abs/p.env'), '/abs/p.env')
  assert.equal(expandHome('relative/p.env'), 'relative/p.env')
})
