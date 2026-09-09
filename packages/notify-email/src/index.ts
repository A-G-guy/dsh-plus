/**
 * dsh 插件：任务结束邮件通知。
 * 在 agent 停止工作的三类时机经配置的 SMTP 邮箱向指定收件人发邮件：
 * 任务执行完毕（最后一条交付消息）、等待用户决策（提问/plan 审批）、报错停止。
 * 扩展接口：第三方插件 ctx.inject(['notifyEmail']) 后 registerTrigger() 注册自定义通知。
 * @module @dsh-plus/notify-email
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type NotifyEmailConfig } from './config.ts'
import { NotifyEmailService } from './service.ts'

export const name = 'dsh-plus-notify-email'

// 行级 inject：loader 须等这些服务激活后才应用本行。credentials 必须在列：
// 服务构造期即读取 credentials seam（行级 inject 是 fiber 链上属性解析的
// 声明来源，服务类 static inject 在 cordis 4.0.2 的类插件挂载里同样生效，
// 两处同声明互为兜底）。
export const inject = ['agents', 'tools', 'credentials'] as const

export { NotifyEmailService } from './service.ts'

export type {
  DecisionCall,
  EmailNotice,
  NotifyTrigger,
  TurnEndInfo,
} from './triggers/types.ts'
export { Config }

export function apply(ctx: Context, config: NotifyEmailConfig): void {
  ctx.plugin(NotifyEmailService, config)
}
