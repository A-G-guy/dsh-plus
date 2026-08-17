/**
 * 内置官方适配器：ask_user_question / exit_plan_mode 决策通知，
 * 以及 turn 结束（completed/error/aborted）通知。按配置 toggles 门控。
 * @module notify-email/triggers/builtin
 */
import type { NotifyEmailConfig } from '../config.ts'
import {
  renderAbortedNotice, renderCompletionNotice, renderErrorNotice,
  renderPlanNotice, renderQuestionNotice,
} from './render.ts'
import type { NotifyTrigger } from './types.ts'

/** 官方决策工具名 → 渲染函数 + 对应 toggle。 */
export function createDecisionTrigger(resolveConfig: () => NotifyEmailConfig): NotifyTrigger {
  return {
    id: 'dsh-plus-official-decision',
    onDecision(call) {
      const cfg = resolveConfig()
      if (call.name === 'ask_user_question' && cfg.triggers.onQuestion) {
        return renderQuestionNotice(call, cfg.maxBodyChars)
      }
      if (call.name === 'exit_plan_mode' && cfg.triggers.onPlanReview) {
        return renderPlanNotice(call, cfg.maxBodyChars)
      }
      return undefined
    },
  }
}

export function createTurnEndTrigger(resolveConfig: () => NotifyEmailConfig): NotifyTrigger {
  return {
    id: 'dsh-plus-official-turn-end',
    onTurnEnd(info) {
      const cfg = resolveConfig()
      if (info.kind === 'completed' && cfg.triggers.onComplete) {
        return renderCompletionNotice(info, cfg.maxBodyChars)
      }
      if (info.kind === 'error' && cfg.triggers.onError) {
        return renderErrorNotice(info, cfg.maxBodyChars)
      }
      if (info.kind === 'aborted' && cfg.triggers.onAborted) {
        return renderAbortedNotice(info)
      }
      return undefined
    },
  }
}
