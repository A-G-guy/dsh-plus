/**
 * 本机官方源码树的读取：`@actual-app/core` 的 `src/`（模型、服务端 handler、共享工具）。
 *
 * 这是「需要看官方实现到底怎么算」时的本地答案：本机已安装、版本与服务端一致、
 * 零外网。读取有边界（文件数、字节数、命中数），越界即明确报告，不静默截断。
 * @module @dsh-plus/actual-reports/core-source
 */

import type { SourceMatch } from './client-source.ts'
import { joinPath, type ReportsIo } from './node-io.ts'

/** 源码树清单。 */
export interface CoreTree {
  root: string
  paths: string[]
  /** 因上限没列全时为 true。 */
  truncated: boolean
}

/** 默认列出的文件数上限。 */
export const CORE_FILE_LIMIT = 4000

/** 检索时读入的源码总字节上限（超出即停并标记）。 */
const CORE_BYTES_LIMIT = 8 * 1024 * 1024

/** 归一化相对路径，并挡住越界。 */
export function safeRelative(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new Error(`源码路径越界：${path}`)
      parts.pop()
      continue
    }
    parts.push(part)
  }
  if (parts.length === 0) throw new Error(`源码路径为空：${JSON.stringify(path)}`)
  return parts.join('/')
}

/** 递归收集源码文件（相对 `coreDir` 的路径，形如 `src/types/prefs.ts`）。 */
export async function listCoreFiles(
  coreDir: string,
  io: ReportsIo,
  options: { match?: string; limit?: number } = {},
): Promise<CoreTree> {
  const limit = options.limit ?? CORE_FILE_LIMIT
  const root = joinPath(coreDir, 'src')
  const paths: string[] = []
  let truncated = false
  const walk = async (dir: string): Promise<void> => {
    if (truncated) return
    const entries = await io.fs.readdir(dir)
    for (const name of entries.sort()) {
      if (truncated) return
      const full = joinPath(dir, name)
      if (await io.fs.isDirectory(full)) {
        await walk(full)
        continue
      }
      if (!/\.(ts|tsx|mts|js)$/.test(name)) continue
      const relative = safeRelative(`src/${full.slice(root.length + 1)}`)
      if (options.match !== undefined && !relative.includes(options.match)) continue
      if (paths.length >= limit) {
        truncated = true
        return
      }
      paths.push(relative)
    }
  }
  await walk(root)
  return { root, paths, truncated }
}

/** 读一份源码（`path` 相对 core 包根）。 */
export async function readCoreFile(coreDir: string, io: ReportsIo, path: string): Promise<string> {
  const full = joinPath(coreDir, safeRelative(path))
  const text = await io.fs.readText(full)
  if (text === undefined) {
    throw new Error(`本机官方源码里没有 ${path}（完整路径 ${full}）。用 --list 看可读路径。`)
  }
  return text
}

/** 正则检索本机源码树。 */
export async function grepCoreFiles(
  coreDir: string,
  io: ReportsIo,
  tree: CoreTree,
  pattern: string,
  options: { context: number; max: number },
): Promise<{ matches: SourceMatch[]; truncated: boolean; scanned: number }> {
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`--grep 不是合法正则：${detail}`)
  }
  const matches: SourceMatch[] = []
  let bytes = 0
  let scanned = 0
  let truncated = false
  for (const path of tree.paths) {
    const text = await io.fs.readText(joinPath(coreDir, safeRelative(path)))
    if (text === undefined) continue
    bytes += text.length
    scanned += 1
    const lines = text.split('\n')
    for (const [index, line] of lines.entries()) {
      if (!regex.test(line)) continue
      if (matches.length >= options.max) {
        truncated = true
        break
      }
      const from = Math.max(0, index - options.context)
      const to = Math.min(lines.length, index + options.context + 1)
      matches.push({ path, line: index + 1, text: lines.slice(from, to).join('\n') })
    }
    if (truncated || bytes > CORE_BYTES_LIMIT) {
      truncated = true
      break
    }
  }
  return { matches, truncated, scanned }
}
