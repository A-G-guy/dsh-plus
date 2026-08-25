/**
 * 分屏布局纯函数测试：分割/替换/移除/焦点移动/尺寸调整。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  type LayoutNode,
  moveFocus,
  paneIds,
  removePane,
  replacePane,
  resizeSibling,
  splitPane,
} from '../src/panel/layout.ts'

const leaf = (id: string): LayoutNode => ({ type: 'pane', sessionId: id })

test('given a single pane, when splitting horizontally, then the tree has two panes and sizes sum to 1', () => {
  const tree = splitPane(leaf('a'), 'a', 'row', 'b')
  assert.deepEqual(paneIds(tree), ['a', 'b'])
  assert.equal(tree.type, 'split', 'root should become a split')
  if (tree.type === 'split') {
    assert.ok(Math.abs(tree.sizes.reduce((s, v) => s + v, 0) - 1) < 1e-9)
    assert.equal(tree.dir, 'row')
  }
})

test('given a split tree, when removing one pane, then the tree collapses back to the sibling pane', () => {
  const tree = splitPane(leaf('a'), 'a', 'row', 'b')
  const reduced = removePane(tree, 'a')
  assert.deepEqual(reduced, leaf('b'))
  assert.equal(removePane(leaf('a'), 'a'), null)
})

test('given a two-level tree, when removing one leaf, then the single-child split is promoted', () => {
  let tree = splitPane(leaf('a'), 'a', 'row', 'b')
  tree = splitPane(tree, 'b', 'col', 'c')
  assert.deepEqual(paneIds(tree), ['a', 'b', 'c'])
  const reduced = removePane(tree, 'b')
  assert.deepEqual(reduced, splitPane(leaf('a'), 'a', 'row', 'c'))
})

test('given a pane, when replacing, then only the session id changes and shape is preserved', () => {
  const tree = splitPane(leaf('a'), 'a', 'row', 'b')
  const replaced = replacePane(tree, 'b', 'z')
  assert.deepEqual(paneIds(replaced), ['a', 'z'])
})

test('given panes, when moving focus, then it cycles through panes in order and wraps', () => {
  let tree = splitPane(leaf('a'), 'a', 'row', 'b')
  tree = splitPane(tree, 'b', 'col', 'c')
  assert.equal(moveFocus(tree, 'a', 1), 'b')
  assert.equal(moveFocus(tree, 'c', 1), 'a', 'should wrap around')
  assert.equal(moveFocus(tree, 'a', -1), 'c', 'should wrap backwards')
  assert.equal(moveFocus(tree, 'missing', 1), null)
})

test('given a split, when resizing siblings, then the pair ratio shifts within the same total', () => {
  const tree = splitPane(leaf('a'), 'a', 'row', 'b')
  const resized = resizeSibling(tree, 'a', 1, 0.75)
  assert.equal(resized.type, 'split')
  if (resized.type === 'split') {
    const total = (resized.sizes[0] ?? 0) + (resized.sizes[1] ?? 0)
    assert.ok(Math.abs(total - 1) < 1e-9)
    assert.ok((resized.sizes[1] ?? 0) > (resized.sizes[0] ?? 0), 'sibling should now be larger')
  }
})

test('given resize ratio out of bounds, when resizing, then the ratio is clamped to [0.1, 0.9]', () => {
  const tree = splitPane(leaf('a'), 'a', 'row', 'b')
  const oversized = resizeSibling(tree, 'a', 1, 5)
  if (oversized.type === 'split') {
    const ratio =
      (oversized.sizes[1] ?? 0) / ((oversized.sizes[0] ?? 0) + (oversized.sizes[1] ?? 0))
    assert.ok(ratio <= 0.9 + 1e-9)
  }
})
