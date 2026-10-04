import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  argvToText,
  type ConfigValue,
  type Draft,
  draftFromValue,
  patchFromDraft,
  textToArgv,
  validateDraft,
} from '../src/client/draft.ts'

/** 命名空间解析值基准。 */
function valueWith(overrides: Partial<ConfigValue> = {}): ConfigValue {
  return {
    enabled: true,
    serverUrl: 'http://127.0.0.1:5006',
    syncId: 'sync-1',
    cliCommand: [],
    cliVersionPolicy: 'warn',
    confirmWrites: true,
    auxTools: true,
    namePrefix: 'actual_',
    ...overrides,
  }
}

/** 草稿基准。 */
function draftWith(overrides: Partial<Draft> = {}): Draft {
  return { ...draftFromValue(valueWith()), ...overrides }
}

test('given argv, when converting to text, then it round-trips through the card', () => {
  assert.equal(argvToText([]), '')
  assert.equal(argvToText(['node', '/opt/cli.js']), 'node /opt/cli.js')
  assert.deepEqual(textToArgv(''), [], '空文本 = 自动探测')
  assert.deepEqual(textToArgv('   '), [])
  assert.deepEqual(textToArgv('  node   /opt/cli.js  '), ['node', '/opt/cli.js'])
})

test('given a resolved value, when seeding the draft, then cliCommand becomes text', () => {
  const draft = draftFromValue(valueWith({ cliCommand: ['node', '/opt/cli.js'] }))
  assert.equal(draft.cliCommand, 'node /opt/cli.js')
  assert.equal(draft.syncId, 'sync-1')
})

test('given a draft, when building the patch, then only this card fields are written', () => {
  const patch = patchFromDraft(draftWith({ syncId: '  spaced  ', cliCommand: 'node  /x.js' }))
  assert.deepEqual(Object.keys(patch).sort(), [
    'auxTools',
    'cliCommand',
    'cliVersionPolicy',
    'confirmWrites',
    'enabled',
    'namePrefix',
    'serverUrl',
    'syncId',
  ])
  assert.equal(patch.syncId, 'spaced', '首尾空白必须修剪')
  assert.deepEqual(patch.cliCommand, ['node', '/x.js'])
})

test('given a valid draft, when validating, then nothing is reported', () => {
  assert.equal(validateDraft(draftWith()), undefined)
  assert.equal(validateDraft(draftWith({ namePrefix: '' })), undefined, '空前缀是合法的')
  assert.equal(validateDraft(draftWith({ cliCommand: '' })), undefined)
  assert.equal(validateDraft(draftWith({ serverUrl: 'https://actual.example:5006' })), undefined)
})

test('given a bad server url, when validating, then it is rejected with a message key', () => {
  for (const url of ['', '   ', '127.0.0.1:5006', 'ftp://x', 'http://']) {
    assert.deepEqual(
      validateDraft(draftWith({ serverUrl: url })),
      { field: 'serverUrl', messageKey: 'serverUrlInvalid' },
      `${url} 应被拒`,
    )
  }
})

test('given quoted cli arguments, when validating, then it is rejected rather than silently mis-split', () => {
  assert.deepEqual(validateDraft(draftWith({ cliCommand: 'node "/opt/my cli.js"' })), {
    field: 'cliCommand',
    messageKey: 'cliCommandInvalid',
  })
  assert.deepEqual(validateDraft(draftWith({ cliCommand: "node '/x.js'" })), {
    field: 'cliCommand',
    messageKey: 'cliCommandInvalid',
  })
})

test('given a tool name prefix with illegal characters, when validating, then it is rejected', () => {
  // 首尾空白由 patchFromDraft 修剪，故「actual 」合法；内部空白不合法。
  for (const prefix of ['actual x', 'actual.', 'ac*tual', '中文']) {
    assert.deepEqual(
      validateDraft(draftWith({ namePrefix: prefix })),
      { field: 'namePrefix', messageKey: 'namePrefixInvalid' },
      `${prefix} 应被拒`,
    )
  }
  for (const prefix of ['actual_', 'ab-', 'A1', ' actual_ ']) {
    assert.equal(validateDraft(draftWith({ namePrefix: prefix })), undefined)
  }
})

test('given several problems, when validating, then the first field in form order wins', () => {
  const violation = validateDraft(
    draftWith({ serverUrl: 'nope', cliCommand: '"q"', namePrefix: '#' }),
  )
  assert.equal(violation?.field, 'serverUrl')
})
