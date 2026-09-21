/**
 * 子进程执行器：spawn 脚本、收集 stdout、超时/abort 杀进程。
 * spawn 依赖注入以便单测 mock（禁网络铁律下测试绝不真实启动搜索脚本）。
 * @module web-search-services/runner
 */
import { spawn } from 'node:child_process'

export type SpawnFn = typeof spawn

export interface RunProcessOptions {
  command: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  cwd?: string | undefined
  timeoutMs: number
  signal?: AbortSignal | undefined
  maxBufferBytes?: number | undefined
  spawnFn?: SpawnFn | undefined
}

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024
const KILL_GRACE_MS = 2_000

export function abortError(): Error {
  const err = new Error('search aborted')
  err.name = 'AbortError'
  return err
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function tail(text: string, max = 500): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(-max)}`
}

/** 运行子进程并返回完整 stdout；任何失败以 Error 拒绝（消息含 stderr/退出码上下文）。 */
export function runProcess(opts: RunProcessOptions): Promise<string> {
  const spawnFn = opts.spawnFn ?? spawn
  return new Promise<string>((resolve, reject) => {
    if (opts.signal?.aborted === true) {
      reject(abortError())
      return
    }
    const child = spawnFn(opts.command, [...opts.args], {
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    })

    const maxBuffer = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER
    let stdout = ''
    let stderr = ''
    let settled = false
    let graceTimer: NodeJS.Timeout | undefined

    const cleanup = (): void => {
      clearTimeout(timer)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const kill = (): void => {
      child.kill('SIGTERM')
      graceTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
      graceTimer.unref()
    }
    const onAbort = (): void => {
      kill()
      settle(() => reject(abortError()))
    }
    const timer = setTimeout(() => {
      kill()
      settle(() => reject(new Error(`process timed out after ${opts.timeoutMs}ms`)))
    }, opts.timeoutMs)
    timer.unref()
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
      if (stdout.length > maxBuffer) {
        kill()
        settle(() => reject(new Error(`stdout exceeded ${maxBuffer} bytes`)))
      }
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      settle(() =>
        reject(new Error(`failed to start ${opts.command}: ${err.message}`, { cause: err })),
      )
    })
    child.on('close', (code) => {
      if (settled) return
      if (code === 0) {
        settle(() => resolve(stdout))
        return
      }
      const detail = tail(stderr) !== '' ? tail(stderr) : tail(stdout)
      settle(() => reject(new Error(`exited with code ${code ?? 'null'}: ${detail}`)))
    })
  })
}
