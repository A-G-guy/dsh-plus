/**
 * 移动端修饰键（sticky-once）纯逻辑测试：Ctrl/Alt/Shift 变换 + 一次性复位。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyModifiers, ModifierStore } from '../src/panel/modifiers.ts'

const none = { ctrl: false, alt: false, shift: false }
const ctrl = { ctrl: true, alt: false, shift: false }
const alt = { ctrl: false, alt: true, shift: false }
const shift = { ctrl: false, alt: false, shift: true }

test('given no active modifiers, when applying, then data passes through unchanged', () => {
  assert.equal(applyModifiers('c', none), 'c')
  assert.equal(applyModifiers('\x1b[D', none), '\x1b[D')
  assert.equal(applyModifiers('\t', none), '\t')
})

test('given ctrl active, when a letter is sent, then it becomes the control byte', () => {
  assert.equal(applyModifiers('c', ctrl), '\x03', 'Ctrl+C = ETX')
  assert.equal(applyModifiers('C', ctrl), '\x03', 'case-insensitive')
  assert.equal(applyModifiers('d', ctrl), '\x04', 'Ctrl+D = EOT')
  assert.equal(applyModifiers('z', ctrl), '\x1a', 'Ctrl+Z = SUB')
  assert.equal(applyModifiers('[', ctrl), '\x1b', 'Ctrl+[ = Esc')
  assert.equal(applyModifiers('?', ctrl), '\x7f', 'Ctrl+? = DEL')
})

test('given ctrl active with an unmappable char, when applying, then the char passes through', () => {
  assert.equal(applyModifiers('5', ctrl), '5')
  assert.equal(applyModifiers('\x1b', ctrl), '\x1b')
})

test('given shift active, when a letter or tab is sent, then it uppercases or backtabs', () => {
  assert.equal(applyModifiers('a', shift), 'A')
  assert.equal(applyModifiers('\t', shift), '\x1b[Z', 'Shift+Tab = backtab')
  assert.equal(applyModifiers('1', shift), '1', 'no IME symbol mapping for digits')
})

test('given alt active, when a char is sent, then it gets an ESC prefix', () => {
  assert.equal(applyModifiers('b', alt), '\x1bb', 'Alt+B = backward-word in readline')
})

test('given modifiers active, when an arrow is sent, then it becomes a modifier-encoded CSI', () => {
  assert.equal(applyModifiers('\x1b[D', ctrl), '\x1b[1;5D', 'Ctrl+Left')
  assert.equal(applyModifiers('\x1b[A', shift), '\x1b[1;2A', 'Shift+Up')
  assert.equal(applyModifiers('\x1b[C', alt), '\x1b[1;3C', 'Alt+Right')
  assert.equal(
    applyModifiers('\x1b[H', { ctrl: true, alt: false, shift: true }),
    '\x1b[1;6H',
    'Ctrl+Shift+Home',
  )
})

test('given a store with ctrl toggled, when consuming once, then output is transformed and modifiers reset', () => {
  const store = new ModifierStore()
  store.toggle('ctrl')
  assert.equal(store.getSnapshot().ctrl, true)
  assert.equal(store.consume('c'), '\x03')
  assert.deepEqual(store.getSnapshot(), none, 'sticky-once: resets after one send')
  assert.equal(store.consume('c'), 'c')
})

test('given a store, when toggling twice, then the modifier deactivates (toggle semantics)', () => {
  const store = new ModifierStore()
  store.toggle('shift')
  store.toggle('shift')
  assert.equal(store.getSnapshot().shift, false)
})
