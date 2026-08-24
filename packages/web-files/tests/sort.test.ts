/**
 * sortEntries 排序规则单测：目录优先、键方向、平手回退。
 * @module @dsh-plus/web-files/tests/sort
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sortEntries } from '../src/panel/sort.ts'
import type { FsEntryDto } from '../src/protocol.ts'

function entry(name: string, kind: FsEntryDto['kind'], size: number, mtimeMs: number): FsEntryDto {
  return { name, path: `/${name}`, kind, hidden: false, size, mtimeMs }
}

const rows: FsEntryDto[] = [
  entry('beta.txt', 'file', 100, 3000),
  entry('docs', 'dir', 0, 9000),
  entry('alpha.md', 'file', 300, 1000),
  entry('media', 'dir', 0, 2000),
  entry('zeta.log', 'file', 20, 5000),
]

function names(list: FsEntryDto[]): string[] {
  return list.map((row) => row.name)
}

describe('sortEntries', () => {
  it('Given 混合条目 When 名称升序 Then 目录优先且文件按名称排序', () => {
    assert.deepEqual(names(sortEntries(rows, 'name', 'asc')), [
      'docs',
      'media',
      'alpha.md',
      'beta.txt',
      'zeta.log',
    ])
  })

  it('Given 混合条目 When 名称降序 Then 目录仍优先且两组各自倒序', () => {
    assert.deepEqual(names(sortEntries(rows, 'name', 'desc')), [
      'media',
      'docs',
      'zeta.log',
      'beta.txt',
      'alpha.md',
    ])
  })

  it('Given 大小不同的文件 When 大小升序 Then 小文件在前且平手回退名称', () => {
    const withTie = [...rows, entry('a-tie.txt', 'file', 100, 100)]
    const sorted = sortEntries(withTie, 'size', 'asc')
    assert.deepEqual(names(sorted), [
      'docs',
      'media',
      'zeta.log',
      'a-tie.txt',
      'beta.txt',
      'alpha.md',
    ])
  })

  it('Given 修改时间不同的条目 When 时间降序 Then 最新在前', () => {
    assert.deepEqual(names(sortEntries(rows, 'mtime', 'desc')), [
      'docs',
      'media',
      'zeta.log',
      'beta.txt',
      'alpha.md',
    ])
  })
})
