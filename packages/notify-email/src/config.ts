/**
 * 配置单一事实源：cordis 行级 Config（组合默认值，dev/prod patch 层可覆盖）
 * 与 settings namespace（用户层，经 dsh-settings-file 持久化到 $DSH_HOME/settings.yaml）
 * 共用同一 schemastery schema。SMTP 密码标记 secret 角色，任何读取通道不得回传。
 * @module notify-email/config
 */
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间；webui 配置卡片与插件运行期读取同一份（字面量见 ./ns.ts）。 */
export const SETTINGS_NS = settingsNamespace(NS_LITERAL)

const SmtpSchema = z.object({
  host: z.string().description('SMTP 服务器主机名').default(''),
  port: z.natural().max(65535).description('SMTP 端口').default(465),
  secure: z.boolean().description('使用 TLS 直连（465 端口通常为 true）').default(true),
  user: z.string().description('SMTP 登录用户名（通常为发件邮箱）').default(''),
  pass: z.string().role('secret').description('SMTP 密码/授权码').default(''),
  from: z.string().description('发件地址（From 头）').default(''),
})

const TriggerSchema = z.object({
  onComplete: z.boolean().description('任务执行完毕时通知').default(true),
  onError: z.boolean().description('任务报错/失败停止时通知').default(true),
  onAborted: z.boolean().description('任务被用户取消时通知').default(false),
  onQuestion: z.boolean().description('agent 提问等待回答时通知').default(true),
  onPlanReview: z.boolean().description('plan 待审批时通知').default(true),
})

export const Config = z.object({
  enabled: z.boolean().description('总开关').default(false),
  smtp: SmtpSchema.default({ host: '', port: 465, secure: true, user: '', pass: '', from: '' }),
  to: z.array(z.string()).description('收件邮箱列表').default([]),
  triggers: TriggerSchema.default({
    onComplete: true, onError: true, onAborted: false, onQuestion: true, onPlanReview: true,
  }),
  idleDebounceMs: z.natural().description('turn 结束后确认无后续工作的等待毫秒数').default(3000),
  maxBodyChars: z.natural().min(200).description('邮件正文内容截断长度').default(4000),
  dryRun: z.boolean().description('仅记录日志不真实发送（开发调试用）').default(false),
})

export type NotifyEmailConfig = Schemastery.TypeT<typeof Config>
export type TriggerToggles = NotifyEmailConfig['triggers']

/** 配置卡片读取用的传输对象：pass 永不回传，只报告是否已配置。 */
export interface WireConfig {
  enabled: boolean
  smtp: {
    host: string
    port: number
    secure: boolean
    user: string
    from: string
    passConfigured: boolean
  }
  to: string[]
  triggers: TriggerToggles
  idleDebounceMs: number
  maxBodyChars: number
  dryRun: boolean
  /** 是否存在可写的 settings provider（决定卡片是否允许编辑）。 */
  writable: boolean
}

export function toWire(cfg: NotifyEmailConfig, writable: boolean): WireConfig {
  return {
    enabled: cfg.enabled,
    smtp: {
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.secure,
      user: cfg.smtp.user,
      from: cfg.smtp.from,
      passConfigured: cfg.smtp.pass.length > 0,
    },
    to: [...cfg.to],
    triggers: { ...cfg.triggers },
    idleDebounceMs: cfg.idleDebounceMs,
    maxBodyChars: cfg.maxBodyChars,
    dryRun: cfg.dryRun,
    writable,
  }
}

/** 是否具备发信条件（enabled 之外的最小完整性）。 */
export function isDeliverable(cfg: NotifyEmailConfig): boolean {
  return cfg.enabled && cfg.smtp.host.length > 0 && cfg.smtp.from.length > 0 && cfg.to.length > 0
}

/**
 * 配置卡片写回用的 patch schema：字段全部可选（无默认值），
 * 只携带用户真实编辑过的字段，交给 settings.update 深合并进用户层。
 */
export const WirePatch = z.object({
  enabled: z.boolean(),
  smtp: z.object({
    host: z.string(),
    port: z.natural().max(65535),
    secure: z.boolean(),
    user: z.string(),
    pass: z.string(),
    from: z.string(),
  }),
  to: z.array(z.string()),
  triggers: z.object({
    onComplete: z.boolean(),
    onError: z.boolean(),
    onAborted: z.boolean(),
    onQuestion: z.boolean(),
    onPlanReview: z.boolean(),
  }),
  idleDebounceMs: z.natural(),
  maxBodyChars: z.natural().min(200),
  dryRun: z.boolean(),
})

export type WirePatchInput = Schemastery.TypeS<typeof WirePatch>

/**
 * 把卡片提交的 patch 规整为 settings.update 的用户层 patch。
 * smtp.pass 为空串表示「保持不变」，从 patch 中剔除，避免覆盖已存密码。
 */
export function toUserPatch(input: WirePatchInput): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...input }
  if (input.smtp !== undefined && input.smtp !== null) {
    const smtp: Record<string, unknown> = { ...input.smtp }
    if (smtp['pass'] === '') delete smtp['pass']
    patch['smtp'] = smtp
  }
  return patch
}
