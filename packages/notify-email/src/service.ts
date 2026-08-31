/**
 * NotifyEmailService：通知编排中枢。
 * - 配置：settings.installSection 接入 settings 用户层（$DSH_HOME/settings.yaml，热生效），
 *   无 settings provider 时退化为 cordis 行级 config。
 * - 触发器：registerTrigger 是第三方插件的扩展接口；内置官方适配器同路径注册。
 * - 投递：首个非空 EmailNotice 经 Mailer 发送；单个触发器抛错不影响其余。
 * @module @dsh-plus/notify-email
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-settings'
import { createJsonlAuditSink } from './audit.ts'
import { Config, type NotifyEmailConfig, SETTINGS_NS } from './config.ts'
import { registerTestApi } from './config-api.ts'
import { Mailer } from './mailer.ts'
import { createDecisionTrigger, createTurnEndTrigger } from './triggers/builtin.ts'
import type { DecisionCall, NotifyTrigger, TurnEndInfo } from './triggers/types.ts'
import { installDecisionWatcher } from './watchers/decision.ts'
import { installTurnEndWatcher } from './watchers/turn-end.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    notifyEmail: NotifyEmailService
  }
}

export class NotifyEmailService extends Service {
  static [Context.inject] = ['agents', 'tools']

  private readonly triggers: NotifyTrigger[] = []
  private readonly mailer: Mailer
  private current: () => NotifyEmailConfig

  constructor(ctx: Context, config: NotifyEmailConfig) {
    super(ctx, 'notifyEmail')
    this.current = () => config
    // 官方 installSection 范式（0.1.2-alpha.2）：settings 在时以行级 config 为
    // base 注册用户层，缺席/detach 时回落行级 config。
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
        setSource: (source) => {
          this.current = source
        },
        onChange: () => {},
      })
    })
    const logger = ctx.logger('notify-email')
    const audit = createJsonlAuditSink(dshHomePath('logs', 'notify-email.jsonl'), (message) =>
      logger.warn(`audit write failed: ${message}`),
    )
    this.mailer = new Mailer(() => this.current(), logger, undefined, audit)
    this.registerTrigger(createDecisionTrigger(() => this.current()))
    this.registerTrigger(createTurnEndTrigger(() => this.current()))
    installDecisionWatcher(ctx, this)
    installTurnEndWatcher(ctx, this, () => this.current())
    ctx.inject(['webServer'], (webCtx) => {
      registerTestApi(webCtx, this)
    })
  }

  /** 注册触发器（第三方扩展接口）；返回注销函数，随调用方 fiber 释放。 */
  registerTrigger(trigger: NotifyTrigger): () => void {
    if (this.triggers.some((t) => t.id === trigger.id)) {
      throw new Error(`notify-email: duplicate trigger id ${JSON.stringify(trigger.id)}`)
    }
    this.triggers.push(trigger)
    return this.ctx.effect(
      () => () => {
        const index = this.triggers.indexOf(trigger)
        if (index >= 0) this.triggers.splice(index, 1)
      },
      `notify-email: trigger ${trigger.id}`,
    )
  }

  /** 当前生效配置（settings 用户层解析结果或 cordis 行级 config）。 */
  currentConfig(): NotifyEmailConfig {
    return this.current()
  }

  /** 决策类观察入口（decision watcher 调用）。 */
  async dispatchDecision(call: DecisionCall): Promise<void> {
    await this.dispatch('decision', call, (t) => t.onDecision?.(call))
  }

  /** 任务停止类观察入口（turn-end watcher 调用）。 */
  async dispatchTurnEnd(info: TurnEndInfo): Promise<void> {
    await this.dispatch('turn-end', info, (t) => t.onTurnEnd?.(info))
  }

  /** 配置卡片「发送测试邮件」：绕过 enabled 门禁，仍需 SMTP 完整。 */
  async sendTest(): Promise<{ ok: boolean; detail: string }> {
    return this.mailer.send(
      {
        subject: '[DSH] 邮件通知测试',
        text: '这是一封来自 dsh notify-email 插件的测试邮件。',
      },
      true,
    )
  }

  /** 通用直发接口（如 lifeboat 故障告警）：走正常 enabled/完整性门禁。 */
  async sendNotice(notice: {
    subject: string
    text: string
  }): Promise<{ ok: boolean; detail: string }> {
    return this.mailer.send(notice)
  }

  private async dispatch<T>(
    kind: string,
    _payload: T,
    produce: (t: NotifyTrigger) => { subject: string; text: string; html?: string } | undefined,
  ): Promise<void> {
    for (const trigger of [...this.triggers]) {
      let notice: ReturnType<typeof produce>
      try {
        notice = produce(trigger)
      } catch (error) {
        this.ctx
          .logger('notify-email')
          .warn(
            `trigger ${trigger.id} failed on ${kind}: ${error instanceof Error ? error.message : String(error)}`,
          )
        continue
      }
      if (notice === undefined) continue
      const result = await this.mailer.send(notice)
      if (!result.ok && result.detail !== 'disabled' && result.detail !== 'incomplete') {
        this.ctx
          .logger('notify-email')
          .warn(`deliver failed via trigger ${trigger.id}: ${result.detail}`)
      }
      return
    }
  }
}
