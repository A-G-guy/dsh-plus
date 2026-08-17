/**
 * dsh 插件：任务结束邮件通知。
 * 在 agent 停止工作的三类时机经配置的 SMTP 邮箱向指定收件人发邮件：
 * 任务执行完毕（最后一条交付消息）、等待用户决策（提问/plan 审批）、报错停止。
 * 扩展接口：第三方插件 ctx.inject(['notifyEmail']) 后 registerTrigger() 注册自定义通知。
 * @module @dsh-custom/notify-email
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type NotifyEmailConfig } from './config.ts'
import { NotifyEmailService } from './service.ts'

export const name = 'dsh-custom-notify-email'

export const inject = ['agents', 'tools'] as const

export { Config }

export type { EmailNotice, DecisionCall, TurnEndInfo, NotifyTrigger } from './triggers/types.ts'
export { NotifyEmailService } from './service.ts'

export function apply(ctx: Context, config: NotifyEmailConfig): void {
  ctx.plugin(NotifyEmailService, config)
}
