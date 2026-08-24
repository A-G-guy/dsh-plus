/**
 * 目录列表排序：纯函数（视图层规则，可脱离 DOM 单测）。
 * 目录永远优先于文件；键相同回退名称升序保证确定性。
 * @module @dsh-plus/web-files/panel/sort
 */
import type { FsEntryDto } from '../protocol.ts'

export type SortKey = 'name' | 'size' | 'mtime'
export type SortDir = 'asc' | 'desc'

export const SORT_KEYS: readonly SortKey[] = ['name', 'size', 'mtime']

/** 排序一层条目：目录优先，组内按键与方向排序，平手回退名称升序。 */
export function sortEntries(
  entries: readonly FsEntryDto[],
  key: SortKey,
  dir: SortDir,
): FsEntryDto[] {
  const sign = dir === 'asc' ? 1 : -1
  const byName = (a: FsEntryDto, b: FsEntryDto) => a.name.localeCompare(b.name)
  return [...entries].sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1
    if (a.kind !== 'dir' && b.kind === 'dir') return 1
    if (key === 'size') return sign * (a.size - b.size) || byName(a, b)
    if (key === 'mtime') return sign * (a.mtimeMs - b.mtimeMs) || byName(a, b)
    return sign * byName(a, b)
  })
}
