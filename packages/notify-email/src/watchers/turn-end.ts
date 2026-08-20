/**
 * 任务停止观察：订阅 session/event 持久事件流。
 * - assistant/message 记录该会话最新的交付文本；
 * - turn/end（completed/error/aborted）且属 runtime root agent → 空闲防抖后下发；
 * - 防抖窗口内新 turn/start 到达则取消（goal 续轮、followup 排队等场景不误报）；
 * - 按 session:turn:kind 去重，同一会话边界不重复通知。
 * @module notify-email/watchers/turn-end
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, TurnEndReason } from '@deepseek-ai/dsh-session'

import type { NotifyEmailConfig } from '../config.ts'
import type { NotifyEmailService } from '../service.ts'

/** 只有这三类 turn 结束对用户有可决策价值；blocked/max-tokens/interrupted 不通知。 */
const NOTIFY_KINDS = new Set(['completed', 'error', 'aborted'])

interface SessionWatch {
  lastDelivery?: string
  timer?: ReturnType<typeof setTimeout>
  readonly notified: Set<string>
}

interface ContentBlockLike {
  type?: string
  text?: unknown
}

/** 从 assistant 消息 content 提取纯文本交付内容（仅 text 块，忽略工具调用等）。 */
export function extractDeliveryText(content: readonly ContentBlockLike[]): string | undefined {
  const text = content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim()
  return text.length > 0 ? text : undefined
}

function extractErrorMessage(reason: unknown): string | undefined {
  if (typeof reason !== 'object' || reason === null) return undefined
  const error = (reason as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return undefined
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : undefined
}

export function installTurnEndWatcher(
  ctx: Context,
  service: NotifyEmailService,
  resolveConfig: () => NotifyEmailConfig,
): void {
  const watches = new Map<string, SessionWatch>()
  const logger = ctx.logger('notify-email')

  const watchOf = (sessionId: string): SessionWatch => {
    let watch = watches.get(sessionId)
    if (watch === undefined) {
      watch = { notified: new Set() }
      watches.set(sessionId, watch)
    }
    return watch
  }

  const fire = (session: Session, turn: number, kind: string, errorMessage?: string): void => {
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    if (agent.status !== 'idle' || agent.inbox.hasPending) return
    if (!ctx.agents.roots().includes(agent)) return
    const watch = watchOf(session.id)
    const key = `${turn}:${kind}`
    if (watch.notified.has(key)) return
    watch.notified.add(key)
    service
      .dispatchTurnEnd({
        sessionId: session.id,
        turn,
        kind,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
        ...(watch.lastDelivery !== undefined ? { lastDelivery: watch.lastDelivery } : {}),
      })
      .catch((error: unknown) => {
        logger.warn(
          `turn-end dispatch failed (${session.id}, turn ${turn}, ${kind}): ` +
            (error instanceof Error ? error.message : String(error)),
        )
      })
  }

  const onTurnEnd = (session: Session, turn: number, reason: TurnEndReason): void => {
    if (!NOTIFY_KINDS.has(reason.kind)) return
    const watch = watchOf(session.id)
    if (watch.timer !== undefined) clearTimeout(watch.timer)
    const errorMessage = extractErrorMessage(reason)
    watch.timer = setTimeout(() => {
      watch.timer = undefined
      fire(session, turn, reason.kind, errorMessage)
    }, resolveConfig().idleDebounceMs)
  }

  ctx.on('session/event', (session, event) => {
    if (event.type === 'assistant/message') {
      const text = extractDeliveryText(event.data.message.content)
      if (text !== undefined) watchOf(session.id).lastDelivery = text
      return
    }
    if (event.type === 'turn/start') {
      const watch = watches.get(session.id)
      if (watch?.timer !== undefined) {
        clearTimeout(watch.timer)
        watch.timer = undefined
      }
      return
    }
    if (event.type === 'turn/end') onTurnEnd(session, event.data.turn, event.data.reason)
  })

  ctx.on('session/disposed', (session) => {
    const watch = watches.get(session.id)
    if (watch?.timer !== undefined) clearTimeout(watch.timer)
    watches.delete(session.id)
  })

  ctx.effect(
    () => () => {
      for (const watch of watches.values()) {
        if (watch.timer !== undefined) clearTimeout(watch.timer)
      }
      watches.clear()
    },
    'notify-email: turn-end timers',
  )
}
