/**
 * 变量名语法测试（Given-When-Then）。
 * @module secret-env/tests/names
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ENV_PREFIX,
  envNameOf,
  isManagedEnvName,
  normalizeSuffix,
  suffixOf,
  validateSuffix,
} from '../src/names.ts'

test('given messy input, when normalizing, then it is trimmed and uppercased', () => {
  assert.equal(normalizeSuffix('  github_token '), 'GITHUB_TOKEN')
  assert.equal(normalizeSuffix('apiKey'), 'APIKEY')
})

test('given valid suffixes, when validating, then null is returned', () => {
  assert.equal(validateSuffix('A'), null)
  assert.equal(validateSuffix('GITHUB_TOKEN_V2'), null)
})

test('given invalid suffixes, when validating, then a structured code is returned', () => {
  assert.equal(validateSuffix(''), 'empty')
  assert.equal(validateSuffix('1TOKEN'), 'bad-charset')
  assert.equal(validateSuffix('HAS-DASH'), 'bad-charset')
  assert.equal(validateSuffix('LOWER'.toLowerCase()), 'bad-charset')
  assert.equal(validateSuffix('A'.repeat(65)), 'too-long')
})

test('given a suffix, when composing the env name, then the managed prefix is applied', () => {
  assert.equal(envNameOf('GITHUB_TOKEN'), `${ENV_PREFIX}GITHUB_TOKEN`)
})

test('given env names, when classifying, then only managed names round-trip to suffixes', () => {
  assert.equal(suffixOf(`${ENV_PREFIX}FOO`), 'FOO')
  assert.equal(suffixOf('DSH_HOME'), undefined)
  assert.equal(suffixOf(ENV_PREFIX), undefined)
  assert.equal(isManagedEnvName(`${ENV_PREFIX}FOO`), true)
  assert.equal(isManagedEnvName('PATH'), false)
})
