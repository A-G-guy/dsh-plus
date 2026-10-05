/**
 * Node 侧真实 I/O 实现（与 cordis/DSH 无关）：spawn 执行、HTTP 探测、
 * 本包可解析的 `@actual-app/cli` 定位。主插件与 stdio 可执行入口共用同一份。
 * @module @dsh-plus/actual-mcp/node-io
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import type { CliDeps } from './cli-run.ts'

/** 单次输出上限（防异常巨量输出撑爆内存）。 */
const MAX_OUTPUT_CHARS = 32 * 1024 * 1024

/** 真实子进程执行：spawn 收集 stdout/stderr；abort 仅终止进程并按退出解析。 */
function execFile(
  file: string,
  args: string[],
  options?: { signal?: AbortSignal; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted === true) {
      resolve({ stdout: '', stderr: 'aborted', code: -1 })
      return
    }
    const child = spawn(file, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options?.env !== undefined ? { env: options.env } : {}),
    })
    let stdout = ''
    let stderr = ''
    let truncated = false
    const append = (target: 'out' | 'err', chunk: string): void => {
      if (target === 'out') {
        if (stdout.length + chunk.length > MAX_OUTPUT_CHARS) truncated = true
        else stdout += chunk
      } else if (stderr.length + chunk.length > MAX_OUTPUT_CHARS) {
        truncated = true
      } else stderr += chunk
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => append('out', chunk))
    child.stderr.on('data', (chunk: string) => append('err', chunk))
    const onAbort = (): void => {
      child.kill('SIGTERM')
    }
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error) => {
      options?.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      options?.signal?.removeEventListener('abort', onAbort)
      const suffix = truncated ? '\n[output truncated]' : ''
      resolve({ stdout: stdout + suffix, stderr: stderr + suffix, code: code ?? -1 })
    })
  })
}

/** 真实 HTTP JSON 探测（非 JSON 时 body 保留原文）。 */
async function fetchJson(
  url: string,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const init: RequestInit = { headers: { accept: 'application/json' } }
  if (options?.signal !== undefined) init.signal = options.signal
  const res = await fetch(url, init)
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text) as unknown
  } catch {
    // 保留原文，调用方按形状自行判读
  }
  return { ok: res.ok, status: res.status, body }
}

/**
 * 定位本包可解析的 `@actual-app/cli` 入口；未安装时返回 undefined
 * （该包是可选 peer：不强制 profile 承担约 225MB 的 CLI 闭包）。
 */
function resolveBundledCli(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    return join(dirname(require.resolve('@actual-app/cli/package.json')), 'dist', 'cli.js')
  } catch {
    return undefined
  }
}

/**
 * 定位伴侣 CLI（`@dsh-plus/actual-reports` 的可执行入口）。
 *
 * 该包是本包的依赖，因此在同一棵 node_modules 里必然可解析；解析不到说明
 * 安装不完整——此时报表族不入目录（`discover` 会记一条告警）。
 */
function resolveReportsCli(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    return join(
      dirname(require.resolve('@dsh-plus/actual-reports/package.json')),
      'lib',
      'bin',
      'report.js',
    )
  } catch {
    return undefined
  }
}

/** 装配 Node 侧真实 I/O 依赖。 */
export function createNodeDeps(): CliDeps {
  return { execFile, fetchJson, env: process.env, resolveBundledCli, resolveReportsCli }
}
