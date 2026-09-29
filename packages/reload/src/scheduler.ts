/**
 * 重启调度状态机：idle → prepared（token 已签发）→ scheduled（缓冲倒计时中，
 * 可取消）→ 进程被 systemd 终止（无持久态，重启后回到 idle）。
 *
 * 安全语义：
 * - 一次性流程：同一时刻仅一个待确认流程，重复 prepare 作废旧 token。
 * - token 带 TTL、confirm/cancel 时惰性校验；confirm 命中 running 防线不消费
 *   token（用户可携同一 token 以 force 重试），scheduled 后同 token confirm 幂等。
 * - 有 running agent 且未 force 时拒绝调度（计数由调用方注入，状态机保持纯）。
 * - spawnRestart 注入：生产为 detached `sudo systemctl restart --no-block`，
 *   测试替换为探针，严禁测试触发真实重启。
 * @module reload/scheduler
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export type SchedulerState = 'idle' | 'prepared' | 'scheduled'

export type ConfirmResult =
  | { kind: 'scheduled'; etaMs: number }
  | { kind: 'invalid-token' }
  | { kind: 'agents-running'; count: number }

export interface SchedulerDeps {
  unitName: string
  confirmTokenTtlMs: number
  serverGraceMs: number
  /** 重启执行探针注入：缺省走生产 `spawnSystemdRestart`（detached sudo systemctl），测试替换为探针，严禁测试触发真实重启。 */
  spawnRestart?: (unitName: string) => void
  /** 并上 undefined：构造处按 `deps.now ?? Date.now` 处理，二者等价。 */
  now?: (() => number) | undefined
  onError?: (message: string) => void
}

/** 生产 spawn 的最小子进程形状（error 监听 + unref；测试注入探针实现同面）。 */
export interface SpawnedChild {
  on(event: 'error', listener: (error: Error) => void): unknown
  unref(): void
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { detached: true; stdio: 'ignore' },
) => SpawnedChild

const spawnImpl: SpawnFn = (command, args, options) => spawn(command, [...args], options)

/**
 * 生产重启：--no-block 使 systemctl 只向 PID1 投递作业即返回，本进程随后被
 * SIGTERM 不影响拉起。必须挂 error 监听——spawn 的异步 ENOENT（如 sudo 缺席、
 * Windows/desktop 误入此路径）若无监听者会变成未捕获异常打崩宿主进程。
 */
export function spawnSystemdRestart(
  unitName: string,
  onError: (message: string) => void,
  spawnFn: SpawnFn = spawnImpl,
): void {
  const child = spawnFn('sudo', ['systemctl', 'restart', '--no-block', unitName], {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', (error) => {
    onError(`重启执行失败（spawn）: ${error.message}`)
  })
  child.unref()
}

export class ReloadScheduler {
  /** 本次进程生命周期标识：客户端轮询 health 直至其变化，据此判定服务已换新。 */
  readonly bootId: string

  private readonly deps: SchedulerDeps
  private state: SchedulerState = 'idle'
  private token: string | null = null
  private tokenExpiresAt = 0
  private graceTimer: NodeJS.Timeout | null = null
  /** 注入的重启探针（测试用）；缺省走 spawnSystemdRestart 生产路径。 */
  private readonly spawnRestart: ((unitName: string) => void) | undefined
  private readonly now: () => number

  constructor(deps: SchedulerDeps) {
    this.deps = deps
    this.spawnRestart = deps.spawnRestart
    this.now = deps.now ?? Date.now
    this.bootId = randomUUID()
  }

  getState(): SchedulerState {
    return this.state
  }

  /** 签发确认 token；重复 prepare 作废旧 token 与未触发的调度。 */
  prepare(): { token: string; expiresAt: number } {
    this.reset()
    this.token = randomUUID()
    this.tokenExpiresAt = this.now() + this.deps.confirmTokenTtlMs
    this.state = 'prepared'
    return { token: this.token, expiresAt: this.tokenExpiresAt }
  }

  /** 确认并调度重启；详见模块头 token 语义。 */
  confirm(token: unknown, opts: { force: boolean; runningAgents: number }): ConfirmResult {
    if (!this.tokenValid(token)) return { kind: 'invalid-token' }
    if (this.state === 'scheduled') return { kind: 'scheduled', etaMs: this.deps.serverGraceMs }
    if (opts.runningAgents > 0 && !opts.force) {
      return { kind: 'agents-running', count: opts.runningAgents }
    }
    this.state = 'scheduled'
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null
      try {
        this.executeSpawn()
      } catch (error) {
        // spawn 同步失败（如 sudo 缺席）：回到 idle 并上报，进程继续服役。
        this.deps.onError?.(
          `重启执行失败: ${error instanceof Error ? error.message : String(error)}`,
        )
        this.reset()
      }
    }, this.deps.serverGraceMs)
    return { kind: 'scheduled', etaMs: this.deps.serverGraceMs }
  }

  /** 执行重启：注入探针原样调用；生产路径带 spawn error 监听（失败回 idle 并上报）。 */
  private executeSpawn(): void {
    if (this.spawnRestart !== undefined) {
      this.spawnRestart(this.deps.unitName)
      return
    }
    spawnSystemdRestart(this.deps.unitName, (message) => {
      this.deps.onError?.(message)
      this.reset()
    })
  }

  /** 取消待确认/待执行的重启流程；token 不匹配或已过期则无效。 */
  cancel(token: unknown): boolean {
    if (!this.tokenValid(token)) return false
    this.reset()
    return true
  }

  /** 无 token 取消：仅供可信本地面（/reload cancel 命令）使用，HTTP 面仍须持 token。 */
  abort(): boolean {
    if (this.state === 'idle') return false
    this.reset()
    return true
  }

  private tokenValid(token: unknown): boolean {
    if (typeof token !== 'string' || token.length === 0 || this.token === null) return false
    if (this.now() >= this.tokenExpiresAt) {
      this.reset()
      return false
    }
    return token === this.token
  }

  private reset(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
    this.token = null
    this.tokenExpiresAt = 0
    this.state = 'idle'
  }
}
