/**
 * 跨平台父目录纯函数单测（客户端无 node:path，按字符串判据处理两种形态）。
 * @module @dsh-plus/web-files/tests/paths
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parentPath } from '../src/paths.ts'

test('given a posix path, when taking the parent, then the posix directory is returned', () => {
  assert.equal(parentPath('/home/user/file.txt'), '/home/user')
  assert.equal(parentPath('/a'), '/')
  assert.equal(parentPath('/'), '/')
})

test('given a windows path, when taking the parent, then backslash segments and drive roots are preserved', () => {
  assert.equal(parentPath('C:\\Users\\agguy\\file.txt'), 'C:\\Users\\agguy')
  assert.equal(parentPath('C:\\Users'), 'C:\\')
  assert.equal(parentPath('C:\\'), 'C:\\')
})

test('given a path without separators, when taking the parent, then a non-empty root-style fallback is returned', () => {
  assert.equal(parentPath('file.txt'), '/')
})
