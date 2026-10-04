/**
 * 发现失败后的指数退避重连调度（独立关注点，定时器可注入以便确定性单测）。
 *
 * 语义：连续失败按 `base × 2^n` 退避（上限 `maxMs`），达到 `maxAttempts`
 * 后放弃并**只告警一次**，等待外部触发（`/reload` 或重装插件）而非无限重试；
 * 一次成功发现经 `reset()` 复位预算。
 * @module @dsh-plus/actual/reconnect
 */

/** 默认退避基数（毫秒）。 */
export const RECONNECT_BASE_MS = 1_000
/** 默认退避上限（毫秒）。 */
export const RECONNECT_MAX_MS = 30_000
/** 默认连续失败上限。 */
export const RECONNECT_MAX_ATTEMPTS = 10

/** 定时器句柄窄面（Node 的 Timeout 天然满足，`unref` 可选）。 */
export interface TimerHandle {
  unref?(): void
}

/** 定时器注入面；默认取全局实现，测试传假实现即可同步驱动。 */
export interface ReconnectTimers {
  set(fn: () => void, delayMs: number): TimerHandle
  clear(handle: TimerHandle): void
}

/** 默认定时器（unref 避免拖住进程退出）。 */
const DEFAULT_TIMERS: ReconnectTimers = {
  set(fn, delayMs) {
    const timer = setTimeout(fn, delayMs)
    timer.unref?.()
    return timer
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

/** 第 `attempt` 次（0 基）重试的退避毫秒数。 */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** attempt, maxMs)
}

/** 调度选项。 */
export interface ReconnectOptions {
  /** 到点后触发一次重试（调用方自行吞错并再次 `schedule()`）。 */
  onAttempt(): void
  /** 连续失败达到上限时调用一次。 */
  onGiveUp(failures: number): void
  timers?: ReconnectTimers
  baseMs?: number
  maxMs?: number
  maxAttempts?: number
}

/** 指数退避重连调度器。 */
export class ReconnectScheduler {
  private readonly options: ReconnectOptions
  private readonly timers: ReconnectTimers
  private readonly baseMs: number
  private readonly maxMs: number
  private readonly maxAttempts: number
  private handle: TimerHandle | undefined
  private attempts = 0
  private gaveUp = false
  private stopped = false

  constructor(options: ReconnectOptions) {
    this.options = options
    this.timers = options.timers ?? DEFAULT_TIMERS
    this.baseMs = options.baseMs ?? RECONNECT_BASE_MS
    this.maxMs = options.maxMs ?? RECONNECT_MAX_MS
    this.maxAttempts = options.maxAttempts ?? RECONNECT_MAX_ATTEMPTS
  }

  /** 连续失败次数（诊断用）。 */
  get failures(): number {
    return this.attempts
  }

  /** 安排一次重试；已有待执行任务或已停止时为空操作。 */
  schedule(): void {
    if (this.stopped || this.handle !== undefined) return
    if (this.attempts >= this.maxAttempts) {
      if (!this.gaveUp) {
        this.gaveUp = true
        this.options.onGiveUp(this.attempts)
      }
      return
    }
    const delay = backoffDelay(this.attempts, this.baseMs, this.maxMs)
    this.attempts += 1
    this.handle = this.timers.set(() => {
      this.handle = undefined
      if (!this.stopped) this.options.onAttempt()
    }, delay)
  }

  /** 一次成功发现后复位预算。 */
  reset(): void {
    this.attempts = 0
    this.gaveUp = false
  }

  /** 停止调度并清理待执行任务。 */
  stop(): void {
    this.stopped = true
    if (this.handle !== undefined) {
      this.timers.clear(this.handle)
      this.handle = undefined
    }
  }
}
