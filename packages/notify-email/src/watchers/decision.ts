/**
 * 决策观察：tools/pre-execute 是零侵入观察点（waterfall，原样放行），
 * 在工具体阻塞等待用户之前触发——时机即「agent 停下等用户决策」。
 * 发送异步进行，绝不拖慢工具闸门；按 callId 去重。
 * @module notify-email/watchers/decision
 */
import type { Context } from '@deepseek-ai/cordis'

import type { NotifyEmailService } from '../service.ts'

export function installDecisionWatcher(ctx: Context, service: NotifyEmailService): void {
  const seen = new Set<string>()
  const logger = ctx.logger('notify-email')
  ctx.on('tools/pre-execute', (exec, next) => {
    if (seen.has(exec.callId)) return next()
    seen.add(exec.callId)
    const sessionId = exec.agent?.id ?? 'unknown'
    service
      .dispatchDecision({
        callId: exec.callId,
        sessionId,
        name: exec.name,
        args: (exec.arguments ?? {}) as Record<string, unknown>,
      })
      .catch((error: unknown) => {
        logger.warn(
          `decision dispatch failed (${exec.name}, call ${exec.callId}): ` +
            (error instanceof Error ? error.message : String(error)),
        )
      })
    return next()
  })
}
