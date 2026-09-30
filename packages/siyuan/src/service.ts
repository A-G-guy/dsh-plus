/**
 * 主插件服务（宿主 realm，键 `siyuan`）：把配置 + 真实 I/O 装配成
 * {@link SiyuanRuntime}，对子插件暴露发现/执行/状态/订阅的薄委托。
 *
 * token 只进 MCP 鉴权头与 docker exec 读取链路；日志与状态均经脱敏。
 * @module @dsh-plus/siyuan/service
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { type Context, Service } from '@deepseek-ai/cordis'
import { effectiveDeny, type SiyuanConfig } from './config.ts'
import type { ConnectionDeps } from './connection.ts'
import type { CapabilityEntry, SiyuanManifest, SiyuanStatus } from './contract.ts'
import { SiyuanMcp } from './mcp.ts'
import { type InvokeOptions, type RuntimeDeps, SiyuanRuntime } from './runtime.ts'

/** 单次 CLI 输出上限（防异常巨量输出撑爆内存）。 */
const MAX_OUTPUT_CHARS = 32 * 1024 * 1024

/** 真实子进程执行：spawn 收集 stdout/stderr；abort 仅终止进程并按退出解析。 */
function execFile(
  file: string,
  args: string[],
  options?: { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted === true) {
      resolve({ stdout: '', stderr: 'aborted', code: -1 })
      return
    }
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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

/** 真实 HTTP JSON 探测（版本端点无需鉴权；非 JSON 原文进 body）。 */
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

/** 装配真实 I/O 依赖。 */
function realDeps(): ConnectionDeps {
  return {
    execFile,
    readFile: (path) => readFile(path, 'utf8'),
    fetchJson,
    env: process.env,
  }
}

/**
 * `ctx.siyuan` 服务：预设子插件（及测试）消费的唯一入口。
 * 构造即建运行时；fiber 卸载经 dispose 释放会话与重连定时器。
 */
export class SiyuanService extends Service {
  private readonly runtime: SiyuanRuntime

  constructor(ctx: Context, config: SiyuanConfig) {
    super(ctx, 'siyuan')
    const logger = ctx.logger('siyuan')
    const deps: RuntimeDeps = {
      ...realDeps(),
      createMcp: (endpoint, token) => new SiyuanMcp(endpoint, token),
    }
    this.runtime = new SiyuanRuntime(
      {
        mode: config.mode,
        endpoint: config.endpoint,
        container: config.container,
        cliCommand: [...config.cliCommand],
        cliWorkspace: config.cliWorkspace,
        token: config.token,
        allow: [...config.allow],
        deny: effectiveDeny(config),
      },
      deps,
      logger,
    )
  }

  /** 触发一次能力发现（单飞；失败抛错，由调用方告警处理）。 */
  discover(): Promise<SiyuanManifest> {
    return this.runtime.discover()
  }

  /** 最近一次成功发现的清单。 */
  manifest(): SiyuanManifest | undefined {
    return this.runtime.manifest()
  }

  /** 执行一次能力调用（MCP 优先，CLI 兜底）。 */
  invoke(
    entry: CapabilityEntry,
    args: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<unknown> {
    return this.runtime.invoke(entry, args, options)
  }

  /**
   * 创建数据历史快照（写前安全网；`repo create`，与思源内置 agent 同 API）。
   * 不受 allow/deny 暴露过滤影响；失败抛错由调用方决定中止或放行。
   */
  snapshot(memo: string, options: InvokeOptions): Promise<unknown> {
    return this.runtime.snapshot(memo, options)
  }

  /** 连接与发现状态（已脱敏）。 */
  status(): SiyuanStatus {
    return this.runtime.status()
  }

  /** 订阅清单变更，返回退订。 */
  onChange(cb: (manifest: SiyuanManifest) => void): () => void {
    return this.runtime.onChange(cb)
  }

  dispose(): void {
    this.runtime.dispose()
  }
}
