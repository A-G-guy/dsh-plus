/**
 * Scrollback 环形缓冲行为测试：行/字节双上限淘汰与 replay 完整性。
 * 纯逻辑，无网络、无 PTY。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Scrollback } from '../src/scrollback.ts'

test('given a fresh buffer, when appending text, then replay returns it verbatim', () => {
  const buffer = new Scrollback({ maxLines: 10, maxBytes: 65536 })
  buffer.append('$ ls\r\nfile1 file2\r\n$ ')
  assert.equal(buffer.replay(), '$ ls\r\nfile1 file2\r\n$ ')
})

test('given more lines than the cap, when appending, then oldest whole lines are evicted and replay starts at a line boundary', () => {
  const buffer = new Scrollback({ maxLines: 3, maxBytes: 65536 })
  buffer.append('line1\nline2\nline3\nline4\nline5\n')
  assert.equal(buffer.replay(), 'line3\nline4\nline5\n')
})

test('given output exceeding the byte cap, when appending, then eviction keeps bytes under the cap', () => {
  const buffer = new Scrollback({ maxLines: 1000, maxBytes: 1024 })
  // 10 行 × ~200B = ~2KB，超出 1024B。
  for (let i = 0; i < 10; i += 1) buffer.append(`${'x'.repeat(199)}${i}\n`)
  assert.ok(buffer.currentBytes() <= 1024, `bytes ${buffer.currentBytes()} should be <= 1024`)
  assert.ok(buffer.replay().endsWith('9\n'))
  // replay 从完整行开始（无断头行）。
  assert.ok(buffer.replay().startsWith('x'.repeat(199)))
})

test('given partial (unclosed) trailing line, when appending more, then the line is stitched in replay', () => {
  const buffer = new Scrollback({ maxLines: 10, maxBytes: 65536 })
  buffer.append('partial-withou')
  buffer.append('t-newline\nsecond\n')
  assert.equal(buffer.replay(), 'partial-without-newline\nsecond\n')
})

test('given line cap, when counting, then an unclosed trailing line counts as one line', () => {
  const buffer = new Scrollback({ maxLines: 2, maxBytes: 65536 })
  buffer.append('a\nb\nc\nd\ntrailing')
  // 上限 2 行：淘汰到只剩 2 行（'d\n' 闭合行 + 'trailing' 残行算 1 行）。
  assert.equal(buffer.lines(), 2)
  assert.equal(buffer.replay(), 'd\ntrailing')
})
