/**
 * 跨平台父目录纯函数（浏览器半可用）。
 * 切分语义复用官方 `pathPartsOf`（`/` 与 `\` 双分隔符），本模块只做
 * 「父目录 + 盘符根修正」：`/a/b` → `/a`、`C:\a\b` → `C:\a`、`/a` → `/`、
 * `C:\a` → `C:\`（`C:` 不是可导航路径，必须补回分隔符）。
 * @module @dsh-plus/web-files/paths
 */
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'

/** 父目录路径；无分隔符输入回退根样式值，保持「始终非空」的导航契约。 */
export function parentPath(path: string): string {
  const { directory } = pathPartsOf(path)
  if (directory === '') {
    // 盘符根（'C:' / 'C:\'）：pathPartsOf 对根输入返回空 directory，原样补全。
    if (/^[A-Za-z]:[/\\]?$/.test(path)) {
      return path.endsWith('/') || path.endsWith('\\') ? path : `${path}\\`
    }
    return path.startsWith('\\') ? '\\' : '/'
  }
  const stripped = directory.replace(/[/\\]+$/, '')
  if (stripped === '') return directory
  // 盘符根：'C:' 不是可导航路径，保留带分隔符的原样 'C:\'。
  if (/^[A-Za-z]:$/.test(stripped)) return directory
  return stripped
}
