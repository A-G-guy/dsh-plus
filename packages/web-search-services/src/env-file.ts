/**
 * search-services skill env 文件解析（纯函数）。
 * 只解析不执行：按行提取 KEY=VALUE，不展开 $ 变量、不运行 shell，畸形行跳过；
 * 文件缺失/不可读返回空表（envFile 是优化来源，不是硬依赖）。
 * @module web-search-services/env-file
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 展开路径开头的 ~（仅 ~ 与 ~/ 两种形态，不借 shell）。 */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function unquote(value: string): string {
  const first = value.charAt(0)
  const last = value.charAt(value.length - 1)
  if (value.length >= 2 && first === last && (first === '"' || first === "'")) {
    return value.slice(1, -1)
  }
  return value
}

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    out[key] = unquote(body.slice(eq + 1).trim())
  }
  return out
}

export function loadEnvFile(path: string): Record<string, string> {
  if (path.trim() === '') return {}
  try {
    return parseEnvText(readFileSync(expandHome(path), 'utf8'))
  } catch {
    return {}
  }
}
