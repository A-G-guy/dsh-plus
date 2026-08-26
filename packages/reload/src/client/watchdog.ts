/**
 * 被动重启检测（watchdog）：页面加载后经 health 建立 bootId 基线，随后低频
 * 轮询与可见性恢复时比对；bootId 变化即服务已被（任何来源）重启 →
 * location.reload() 拉取新 bundle（?rev= 内容哈希保证拿到新包）。
 * 与主动 /reload 流程（flow.ts）互补：那条路只覆盖本插件发起、且在同一
 * 浏览器内的重启；本模块覆盖 systemctl / 其他设备发起 / 直接 kill 等
 * 一切外部来源。与 flow 同时触发 reload 无害（幂等）。
 * 定时器/fetch/reload 全部注入，测试零浏览器依赖。
 * @module reload/client/watchdog
 */

export interface HealthLike {
  ok: boolean
  bootId: string
  /** host 下发的轮询间隔毫秒数；0 = 关闭被动检测；缺省走 fallback。 */
  watchdogIntervalMs?: number
}

export interface WatchdogDeps {
  fetchHealth(): Promise<HealthLike>
  reload(): void
  /** health 未下发 watchdogIntervalMs（旧版 host）时的兜底间隔。 */
  fallbackIntervalMs: number
  setIntervalFn(fn: () => void, ms: number): unknown
  clearIntervalFn(handle: unknown): void
}

export interface Watchdog {
  /** 立即检查一次（未建基线则建基线）；可见性恢复时调用。 */
  checkNow(): Promise<void>
  stop(): void
}

export function startRestartWatchdog(deps: WatchdogDeps): Watchdog {
  let baseline: string | null = null
  let inflight = false
  let stopped = false
  let timer: unknown = null

  const stop = (): void => {
    stopped = true
    if (timer !== null) {
      deps.clearIntervalFn(timer)
      timer = null
    }
  }

  const check = async (): Promise<void> => {
    if (stopped || inflight) return
    inflight = true
    try {
      const health = await deps.fetchHealth()
      if (stopped) return
      if (baseline === null) {
        baseline = health.bootId
        const interval = health.watchdogIntervalMs ?? deps.fallbackIntervalMs
        if (interval > 0) timer = deps.setIntervalFn(() => void check(), interval)
        return
      }
      if (health.bootId !== baseline) {
        stop()
        deps.reload()
      }
    } catch {
      // 服务不可达（重启中/网络抖动）：保持基线，下个周期再试。
    } finally {
      inflight = false
    }
  }

  void check()
  return { checkNow: check, stop }
}
