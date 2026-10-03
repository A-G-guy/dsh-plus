/**
 * 「重新加载」流程状态机（hook 形态，与渲染分离）。
 * 两条独立子流程，各自一个 hook，由 useReloadFlow 合成一个 phase 供渲染：
 * - 进程内重载（默认）：apply → 报告（已生效 / 需重启清单 / 失败）；有运行中
 *   会话时先询问是否强制执行（对应 pi 的「等当前响应结束」）。
 * - 重启服务（次级，保留原有语义）：prepare → 可取消倒计时（有 running 会话时
 *   归零不自动确认，须点「仍然重启」force）→ confirm → 轮询 health 至 bootId
 *   变化 → location.reload()；多标签页经 localStorage 标记接力。
 * @module reload/client/flow
 */
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { ApiError, fetchHealth, postApply, postCancel, postConfirm, postPrepare } from './api.ts'
import type { Translate } from './i18n.ts'

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

export type ApplyPhase =
  | { kind: 'idle' }
  /** 进程内重载进行中。 */
  | { kind: 'applying' }
  /** 进程内重载报告：text 为 host 侧原文，原样渲染。 */
  | {
      kind: 'result'
      status: 'applied' | 'unsupported' | 'failed'
      text: string
      pendingRestart: string[]
    }
  /** 有会话在运行：询问是否强制进程内重载。 */
  | { kind: 'forceAsk'; runningAgents: number }

export type RestartPhase =
  | { kind: 'idle' }
  /** 重启通道：预检中。 */
  | { kind: 'preparing' }
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
  /** 重启通道自身失败（预检未通过/确认过期/网络错误）的报告。 */
  | { kind: 'report'; text: string }

export type Phase = ApplyPhase | RestartPhase

export interface Flow {
  phase: Phase
  /** 进程内重载（默认动作）。 */
  apply: () => void
  /** 进程内重载（跳过运行中会话防线）。 */
  applyForce: () => void
  /** 重启服务（次级动作）。 */
  startRestart: () => void
  restartNow: () => void
  forceRestart: () => void
  cancel: () => void
  dismiss: () => void
  retry: () => void
}

// 文案翻译面：组件注入 locale bind 结果，hook 不感知 locale 机制。
// Translate 从 i18n 复用（键为 DictKey 字面量联合，拼错键编译期报错）。
export type { Translate }

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

/** 错误值的可读文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ApplyFlow {
  phase: ApplyPhase
  apply: () => void
  applyForce: () => void
  dismiss: () => void
}

/** 进程内重载子流程：一次请求一次报告，无倒计时、无 token。 */
function useApplyFlow(): ApplyFlow {
  const [phase, setPhase] = useState<ApplyPhase>({ kind: 'idle' })

  const runApply = useCallback(async (force: boolean): Promise<void> => {
    setPhase({ kind: 'applying' })
    try {
      const info = await postApply(force)
      if (info.status === 'agents-running') {
        setPhase({ kind: 'forceAsk', runningAgents: info.runningAgents })
        return
      }
      setPhase({
        kind: 'result',
        status: info.status,
        text: info.text,
        pendingRestart: info.pendingRestart,
      })
    } catch (error) {
      setPhase({ kind: 'result', status: 'failed', text: messageOf(error), pendingRestart: [] })
    }
  }, [])

  const apply = useCallback((): void => {
    void runApply(false)
  }, [runApply])

  const applyForce = useCallback((): void => {
    void runApply(true)
  }, [runApply])

  const dismiss = useCallback((): void => {
    setPhase((current) =>
      current.kind === 'result' || current.kind === 'forceAsk' ? { kind: 'idle' } : current,
    )
  }, [])

  return { phase, apply, applyForce, dismiss }
}

interface RestartFlow {
  phase: RestartPhase
  startRestart: () => void
  cancel: () => void
  restartNow: () => void
  forceRestart: () => void
  retry: () => void
  dismiss: () => void
}

/** 确认重启（携带 token 与是否强制）。 */
type Confirm = (
  token: string,
  force: boolean,
  bootId: string,
  pollTimeoutMs: number,
) => Promise<void>

/** 倒计时滴答：归零且无 running 会话时自动确认；有 running 会话停在 0 等 force。 */
function useCountdownTick(
  phase: RestartPhase,
  confirm: Confirm,
  setPhase: Dispatch<SetStateAction<RestartPhase>>,
): void {
  useEffect(() => {
    if (phase.kind !== 'countdown') return
    if (phase.left === 0) {
      if (phase.runningAgents === 0) {
        void confirm(phase.token, false, phase.bootId, phase.pollTimeoutMs)
      }
      return
    }
    const timer = setTimeout(() => {
      setPhase((current) =>
        current.kind === 'countdown' ? { ...current, left: current.left - 1 } : current,
      )
    }, 1000)
    return () => clearTimeout(timer)
  }, [phase, confirm, setPhase])
}

/**
 * 挂载接力：本页是刷新后重生（bootId 已变 → 清标记）或其他标签页发起中（接力轮询）。
 * 只在自身空闲（idle）时接受 storage 通知，避免抢占进行中的本地流程。
 */
function useRestartRelay(
  phaseRef: MutableRefObject<RestartPhase>,
  adopt: (flag: RestartFlag) => void,
): void {
  useEffect(() => {
    const existing = readFlag()
    if (existing) {
      void fetchHealth()
        .then((health) => {
          if (health.bootId !== existing.bootId) localStorage.removeItem(RESTART_FLAG)
          else adopt(existing)
        })
        .catch(() => adopt(existing))
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== RESTART_FLAG || !event.newValue || phaseRef.current.kind !== 'idle') return
      const flag = readFlag()
      if (flag) adopt(flag)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [adopt, phaseRef])
}

/** 重启服务子流程：预检 → 倒计时 → 确认 → 轮询恢复 → 刷新页面（多标签页接力）。 */
function useRestartFlow(t: Translate): RestartFlow {
  const [phase, setPhase] = useState<RestartPhase>({ kind: 'idle' })
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
      setPhase({ kind: 'timeout', bootId: phase.bootId, pollTimeoutMs: phase.pollTimeoutMs })
    })
  }, [phase])

  const adopt = useCallback((flag: RestartFlag): void => {
    setPhase({ kind: 'restarting', bootId: flag.bootId, pollTimeoutMs: flag.pollTimeoutMs })
  }, [])
  useRestartRelay(phaseRef, adopt)

  const confirm = useCallback<Confirm>(
    async (token, force, bootId, pollTimeoutMs) => {
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
          return
        }
        setPhase({
          kind: 'report',
          text:
            error instanceof ApiError && error.status === 403
              ? t('tokenExpired')
              : messageOf(error),
        })
      }
    },
    [t],
  )

  useCountdownTick(phase, confirm, setPhase)

  const startRestart = useCallback((): void => {
    void (async () => {
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
        setPhase({
          kind: 'report',
          text:
            error instanceof ApiError && error.preflight
              ? [t('preflightFailed'), ...error.preflight.reasons.map((r) => `- ${r}`)].join('\n')
              : messageOf(error),
        })
      }
    })()
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
    if (current.kind === 'countdown') {
      void confirm(current.token, true, current.bootId, current.pollTimeoutMs)
    }
  }, [confirm])

  const retry = useCallback((): void => {
    const current = phaseRef.current
    if (current.kind !== 'timeout') return
    writeFlag(current.bootId, current.pollTimeoutMs)
    setPhase({ kind: 'restarting', bootId: current.bootId, pollTimeoutMs: current.pollTimeoutMs })
  }, [])

  const dismiss = useCallback((): void => {
    const current = phaseRef.current
    if (current.kind === 'timeout' || current.kind === 'report') setPhase({ kind: 'idle' })
  }, [])

  return { phase, startRestart, cancel, restartNow, forceRestart, retry, dismiss }
}

export function useReloadFlow(t: Translate): Flow {
  const applyFlow = useApplyFlow()
  const restartFlow = useRestartFlow(t)
  // 同一时刻只有一条子流程在跑：非 idle 的那条胜出。
  const phase: Phase = applyFlow.phase.kind === 'idle' ? restartFlow.phase : applyFlow.phase
  const dismiss = useCallback((): void => {
    applyFlow.dismiss()
    restartFlow.dismiss()
  }, [applyFlow, restartFlow])
  return {
    phase,
    apply: applyFlow.apply,
    applyForce: applyFlow.applyForce,
    startRestart: restartFlow.startRestart,
    restartNow: restartFlow.restartNow,
    forceRestart: restartFlow.forceRestart,
    cancel: restartFlow.cancel,
    dismiss,
    retry: restartFlow.retry,
  }
}
