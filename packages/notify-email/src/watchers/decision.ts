/**
 * 决策观察：tools/pre-execute 是零侵入观察点（waterfall，原样放行），
 * 在工具体阻塞等待用户之前触发——时机即「agent 停下等用户决策」。
 * 发送异步进行，绝不拖慢工具闸门；按 callId 去重。
 * @module notify-email/watchers/decision
 */
import type { Context } from '@deepseek-ai/cordis'

import type { NotifyEmailService } from '../service.ts'

export function installDecisionWatcher(ctx: Context, service: NotifyEmailService): void {
  // 按 sessionId 分桶去重：callId 粒度的全局集合会随每个工具调用无限增长；
  // 会话销毁即整桶释放。无 agent 归属的调用落到 unknown 桶（无生命周期可挂），
  // 以有界环形覆盖兜底，保证任何路径都不产生无界内存。
  const seen = new Map<string, Set<string>>()
  const UNKNOWN_BUCKET_CAP = 1000
  const logger = ctx.logger('notify-email')
  ctx.on('tools/pre-execute', (exec, next) => {
    const sessionId = exec.agent?.id ?? 'unknown'
    let bucket = seen.get(sessionId)
    if (bucket === undefined) {
      bucket = new Set()
      seen.set(sessionId, bucket)
    }
    if (bucket.has(exec.callId)) return next()
    if (sessionId === 'unknown' && bucket.size >= UNKNOWN_BUCKET_CAP) bucket.clear()
    bucket.add(exec.callId)
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
  ctx.on('session/disposed', (session) => {
    seen.delete(session.id)
  })
}
