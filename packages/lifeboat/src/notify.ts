/**
 * 告警出口：优先复用 notify-email 服务（懒取，不 inject 不 import——notify-email
 * 自身被隔离时救生艇仍需工作），缺席降级为 logger.warn。所有告警同时进 journal。
 * @module lifeboat/notify
 */
import type { Context, Logger } from '@deepseek-ai/cordis'

/** notify-email 服务的最小 duck 接口（避免 import 依赖）。 */
interface NotifyEmailLike {
  sendNotice?(notice: { subject: string; text: string }): Promise<{ ok: boolean; detail: string }>
}

export type Alerter = (subject: string, text: string) => void

/**
 * 装配告警出口。返回同步派单函数：内部异步发送，失败只记日志。
 * notify-email 出现时升级为邮件；全程 journal 兜底可溯。
 */
export function installAlerter(ctx: Context, journal: (kind: string, detail: string) => void): Alerter {
  const logger: Logger = ctx.logger('lifeboat')
  let mailer: NotifyEmailLike | undefined
  ctx.inject(['notifyEmail' as never], (mailCtx) => {
    mailer = (mailCtx as unknown as { notifyEmail: NotifyEmailLike }).notifyEmail
    return () => {
      mailer = undefined
    }
  })
  return (subject, text) => {
    journal('alert', `${subject} | ${text}`)
    const active = mailer
    if (!active?.sendNotice) {
      logger.warn(`${subject} —— ${text}`)
      return
    }
    void active.sendNotice({ subject, text }).then((result) => {
      if (!result.ok) logger.warn(`邮件告警投递失败: ${result.detail}`)
    }, (error: unknown) => {
      logger.warn(`邮件告警异常: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
}
