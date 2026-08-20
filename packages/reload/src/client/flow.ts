/**
 * 「重新加载」流程状态机（hook 形态，与渲染分离）。
 * 流程：prepare → 可取消倒计时（有 running 会话时归零不自动确认，须点
 * 「仍然重启」force）→ confirm → 轮询 health 至 bootId 变化 → location.reload()。
 * 多标签页：confirm 成功写 localStorage 标记，其他标签页 storage 事件接力刷新。
 * @module reload/client/flow
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, fetchHealth, postCancel, postConfirm, postPrepare } from './api.ts'

/** 多标签页联动的 localStorage 键。 */
const RESTART_FLAG = 'dsh-plus-reload:restarting'
/** 标记新鲜度窗口：超过即视为上一世代残留，直接清除。 */
const FLAG_FRESH_MS = 10 * 60 * 1000
/** health 轮询间隔。 */
const POLL_INTERVAL_MS = 1000

interface RestartFlag {
  bootId: string
  at: number
  pollTimeoutMs: number
}

export type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'failed'; title: string; lines: string[] }
  | {
      kind: 'countdown'
      token: string
      left: number
      runningAgents: number
      bootId: string
      pollTimeoutMs: number
    }
  | { kind: 'restarting'; bootId: string; pollTimeoutMs: number }
  | { kind: 'timeout'; bootId: string; pollTimeoutMs: number }

export interface Flow {
  phase: Phase
  start: () => void
  restartNow: () => void
  forceRestart: () => void
  cancel: () => void
  dismiss: () => void
  retry: () => void
}

/** 文案翻译面：组件注入 locale bind 结果，hook 不感知 locale 机制。 */
export type Translate = (key: string) => string

function readFlag(): RestartFlag | null {
  try {
    const raw = localStorage.getItem(RESTART_FLAG)
    if (!raw) return null
    const flag = JSON.parse(raw) as RestartFlag
    if (typeof flag.bootId !== 'string' || Date.now() - flag.at > FLAG_FRESH_MS) {
      localStorage.removeItem(RESTART_FLAG)
      return null
    }
    return flag
  } catch {
    return null
  }
}

function writeFlag(bootId: string, pollTimeoutMs: number): void {
  const flag: RestartFlag = { bootId, at: Date.now(), pollTimeoutMs }
  localStorage.setItem(RESTART_FLAG, JSON.stringify(flag))
}

/** 轮询 health 直至 bootId 变化后刷新页面；超时回调由调用方接管。 */
function pollUntilRestarted(flag: RestartFlag, onTimeout: () => void): () => void {
  const deadline = Date.now() + flag.pollTimeoutMs
  const timer = setInterval(() => {
    if (Date.now() > deadline) {
      clearInterval(timer)
      onTimeout()
      return
    }
    void fetchHealth()
      .then((health) => {
        if (health.bootId !== flag.bootId) {
          clearInterval(timer)
          localStorage.removeItem(RESTART_FLAG)
          location.reload()
        }
      })
      .catch(() => {
        // 服务尚未恢复（连接拒绝/重置）：继续等，超时由 deadline 兜底。
      })
  }, POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}

export function useReloadFlow(t: Translate): Flow {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // restarting 阶段的唯一轮询驱动：无论从哪条路径进入都生效。
  useEffect(() => {
    if (phase.kind !== 'restarting') return
    const flag: RestartFlag = {
      bootId: phase.bootId,
      at: Date.now(),
      pollTimeoutMs: phase.pollTimeoutMs,
    }
    return pollUntilRestarted(flag, () => {
      setPhase({
        kind: 'timeout',
        bootId: phase.bootId,
        pollTimeoutMs: phase.pollTimeoutMs,
      })
    })
  }, [phase])

  // 挂载接力：本页是刷新后重生（bootId 已变 → 清标记）或其他标签页发起中（接力轮询）。
  useEffect(() => {
    const existing = readFlag()
    if (existing) {
      void fetchHealth()
        .then((health) => {
          if (health.bootId !== existing.bootId) {
            localStorage.removeItem(RESTART_FLAG)
          } else {
            setPhase({
              kind: 'restarting',
              bootId: existing.bootId,
              pollTimeoutMs: existing.pollTimeoutMs,
            })
          }
        })
        .catch(() => {
          setPhase({
            kind: 'restarting',
            bootId: existing.bootId,
            pollTimeoutMs: existing.pollTimeoutMs,
          })
        })
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== RESTART_FLAG || !event.newValue || phaseRef.current.kind !== 'idle') return
      const flag = readFlag()
      if (flag)
        setPhase({
          kind: 'restarting',
          bootId: flag.bootId,
          pollTimeoutMs: flag.pollTimeoutMs,
        })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const confirm = useCallback(
    async (token: string, force: boolean, bootId: string, pollTimeoutMs: number): Promise<void> => {
      try {
        await postConfirm(token, force)
        writeFlag(bootId, pollTimeoutMs)
        setPhase({ kind: 'restarting', bootId, pollTimeoutMs })
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          typeof error.runningAgents === 'number'
        ) {
          // prepare 后才有会话进入 running：回到倒计时 0 的待命态，等用户 force。
          setPhase({
            kind: 'countdown',
            token,
            left: 0,
            runningAgents: error.runningAgents,
            bootId,
            pollTimeoutMs,
          })
        } else if (error instanceof ApiError && error.status === 403) {
          setPhase({ kind: 'failed', title: '', lines: [t('tokenExpired')] })
        } else {
          setPhase({
            kind: 'failed',
            title: '',
            lines: [error instanceof Error ? error.message : String(error)],
          })
        }
      }
    },
    [t],
  )

  // 倒计时滴答：归零且无 running 会话时自动确认；有 running 会话停在 0 等 force。
  useEffect(() => {
    if (phase.kind !== 'countdown') return
    if (phase.left === 0) {
      if (phase.runningAgents === 0)
        void confirm(phase.token, false, phase.bootId, phase.pollTimeoutMs)
      return
    }
    const timer = setTimeout(() => {
      setPhase((current) =>
        current.kind === 'countdown' ? { ...current, left: current.left - 1 } : current,
      )
    }, 1000)
    return () => clearTimeout(timer)
  }, [phase, confirm])

  const start = useCallback(async (): Promise<void> => {
    setPhase({ kind: 'preparing' })
    try {
      const info = await postPrepare()
      setPhase({
        kind: 'countdown',
        token: info.token,
        left: Math.max(0, info.countdownSeconds),
        runningAgents: info.runningAgents,
        bootId: info.bootId,
        pollTimeoutMs: info.pollTimeoutMs,
      })
    } catch (error) {
      if (error instanceof ApiError && error.preflight) {
        setPhase({
          kind: 'failed',
          title: t('preflightFailed'),
          lines: error.preflight.reasons,
        })
      } else {
        setPhase({
          kind: 'failed',
          title: '',
          lines: [error instanceof Error ? error.message : String(error)],
        })
      }
    }
  }, [t])

  const cancel = useCallback((): void => {
    const current = phaseRef.current
    if (current.kind === 'countdown') void postCancel(current.token)
    setPhase({ kind: 'idle' })
  }, [])

  const restartNow = useCallback((): void => {
    const current = phaseRef.current
    if (current.kind === 'countdown' && current.runningAgents === 0) {
      void confirm(current.token, false, current.bootId, current.pollTimeoutMs)
    }
  }, [confirm])

  const forceRestart = useCallback((): void => {
    const current = phaseRef.current
    if (current.kind === 'countdown')
      void confirm(current.token, true, current.bootId, current.pollTimeoutMs)
  }, [confirm])

  const retry = useCallback((): void => {
    const current = phaseRef.current
    if (current.kind !== 'timeout') return
    writeFlag(current.bootId, current.pollTimeoutMs)
    setPhase({
      kind: 'restarting',
      bootId: current.bootId,
      pollTimeoutMs: current.pollTimeoutMs,
    })
  }, [])

  const dismiss = useCallback((): void => {
    if (phaseRef.current.kind === 'failed' || phaseRef.current.kind === 'timeout')
      setPhase({ kind: 'idle' })
  }, [])

  return { phase, start, restartNow, forceRestart, cancel, dismiss, retry }
}
