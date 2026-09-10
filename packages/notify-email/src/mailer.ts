/**
 * 邮件发送：nodemailer 封装 + dry-run 兜底。
 * Transport 抽象为函数注入，单元测试以假 transport 断言参数，零网络。
 * @module notify-email/mailer
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import nodemailer from 'nodemailer'

import { type AuditSink, buildAuditRecord } from './audit.ts'
import { type NotifyEmailConfig, SMTP_PASS_REF } from './config.ts'

/** 一封待发邮件（触发器产物的最小契约）。 */
export interface MailMessage {
  subject: string
  text: string
  html?: string
}

export interface SendResult {
  ok: boolean
  /** 'sent' | 'dry-run' | 'disabled' | 'incomplete' | 错误消息。 */
  detail: string
}

/** 发送通道：按生效配置投递一封邮件；失败抛错由调用方归一化。 */
export type Transport = (
  cfg: NotifyEmailConfig,
  msg: MailMessage,
  credentials?: CredentialsSeamLike,
) => Promise<void>

/** credentials seam 最小面（Mailer 不感知完整 seam 类型）。 */
export interface CredentialsSeamLike {
  resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined>
}

export interface MailLogger {
  info(msg: string): void
  warn(msg: string): void
}

/**  nodemailer 连接/问候/套接字超时（毫秒），防 SMTP 不可达时挂住通知链路。 */
const CONNECTION_TIMEOUT_MS = 10_000
const GREETING_TIMEOUT_MS = 10_000
const SOCKET_TIMEOUT_MS = 30_000

/** 真实 SMTP 通道：每次发送按当前配置新建 transport（配置热改即生效，发送低频无池化需求）。
 * 密码优先 credentials seam（NOTIFY_EMAIL_SMTP_PASS），缺席回落行级 smtp.pass（兼容注入场景）。 */
export const smtpTransport: Transport = async (cfg, msg, credentials) => {
  const pass = await resolvePass(cfg, credentials)
  const transporter = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user.length > 0 && pass !== null ? { user: cfg.smtp.user, pass } : undefined,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  })
  await transporter.sendMail({
    from: cfg.smtp.from,
    to: cfg.to.join(', '),
    subject: msg.subject,
    text: msg.text,
    ...(msg.html !== undefined ? { html: msg.html } : {}),
  })
}

/** 解析生效密码：credentials 引用优先，行级 secret 兜底；两处皆空返回 null。 */
async function resolvePass(
  cfg: NotifyEmailConfig,
  credentials: CredentialsSeamLike | undefined,
): Promise<string | null> {
  if (credentials !== undefined) {
    const resolved = await credentials.resolve(credentialRef(SMTP_PASS_REF)).catch(() => undefined)
    if (resolved !== undefined && resolved.value.length > 0) return resolved.value
  }
  return cfg.smtp.pass.length > 0 ? cfg.smtp.pass : null
}

export class Mailer {
  private readonly resolveConfig: () => NotifyEmailConfig
  private readonly logger: MailLogger
  private readonly transport: Transport
  // 构造期无条件赋值，故为「必需但可为 undefined」：exactOptionalPropertyTypes
  // 下可选属性不允许显式赋 undefined。
  private readonly audit: AuditSink | undefined
  private readonly credentials: CredentialsSeamLike | undefined

  constructor(
    resolveConfig: () => NotifyEmailConfig,
    logger: MailLogger,
    transport: Transport = smtpTransport,
    audit?: AuditSink,
    credentials?: CredentialsSeamLike,
  ) {
    this.resolveConfig = resolveConfig
    this.logger = logger
    this.transport = transport
    this.audit = audit
    this.credentials = credentials
  }

  /**
   * 常规通知发送：受 enabled 与配置完整性门禁。
   * @param force 为 true 时跳过 enabled 门禁（配置卡片的「发送测试邮件」），仍需 SMTP 完整。
   */
  async send(msg: MailMessage, force = false): Promise<SendResult> {
    const cfg = this.resolveConfig()
    if (!force && !cfg.enabled) return this.record(msg, cfg, { ok: false, detail: 'disabled' })
    if (cfg.smtp.host.length === 0 || cfg.smtp.from.length === 0 || cfg.to.length === 0) {
      return this.record(msg, cfg, { ok: false, detail: 'incomplete' })
    }
    if (cfg.dryRun) {
      this.logger.info(`[dry-run] subject=${msg.subject}\n${msg.text}`)
      return this.record(msg, cfg, { ok: true, detail: 'dry-run' })
    }
    try {
      await this.transport(cfg, msg, this.credentials)
      return this.record(msg, cfg, { ok: true, detail: 'sent' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`send failed: ${message} (subject=${msg.subject})`)
      return this.record(msg, cfg, { ok: false, detail: message })
    }
  }

  private record(msg: MailMessage, cfg: NotifyEmailConfig, result: SendResult): SendResult {
    this.audit?.(buildAuditRecord(msg.subject, msg.text, cfg.to, result.detail))
    return result
  }
}
