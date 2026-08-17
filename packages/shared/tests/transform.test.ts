import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isTransformOp, transformText, TRANSFORM_OPS } from '../src/index.ts'

test('given text and uppercase op, when transforming, then returns uppercased text', () => {
  assert.equal(transformText('hello dsh', 'uppercase'), 'HELLO DSH')
})

test('given text and lowercase op, when transforming, then returns lowercased text', () => {
  assert.equal(transformText('HeLLo', 'lowercase'), 'hello')
})

test('given unicode text and reverse op, when transforming, then reverses by code point', () => {
  assert.equal(transformText('ab中文', 'reverse'), '文中ba')
})

test('given text and length op, when transforming, then counts code points', () => {
  assert.equal(transformText('中文🙂', 'length'), '3')
})

test('given known op names, when narrowing, then all enum members pass', () => {
  for (const op of TRANSFORM_OPS) assert.ok(isTransformOp(op))
  assert.ok(!isTransformOp('nope'))
})
