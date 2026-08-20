/**
 * 邮件发送：nodemailer 封装 + dry-run 兜底。
 * Transport 抽象为函数注入，单元测试以假 transport 断言参数，零网络。
 * @module notify-email/mailer
 */
import nodemailer from 'nodemailer'

import { type AuditSink, buildAuditRecord } from './audit.ts'
import type { NotifyEmailConfig } from './config.ts'

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
export type Transport = (cfg: NotifyEmailConfig, msg: MailMessage) => Promise<void>

export interface MailLogger {
  info(msg: string): void
  warn(msg: string): void
}

/**  nodemailer 连接/问候/套接字超时（毫秒），防 SMTP 不可达时挂住通知链路。 */
const CONNECTION_TIMEOUT_MS = 10_000
const GREETING_TIMEOUT_MS = 10_000
const SOCKET_TIMEOUT_MS = 30_000

/** 真实 SMTP 通道：每次发送按当前配置新建 transport（配置热改即生效，发送低频无池化需求）。 */
export const smtpTransport: Transport = async (cfg, msg) => {
  const transporter = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user.length > 0 ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
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

export class Mailer {
  private readonly resolveConfig: () => NotifyEmailConfig
  private readonly logger: MailLogger
  private readonly transport: Transport
  private readonly audit?: AuditSink

  constructor(
    resolveConfig: () => NotifyEmailConfig,
    logger: MailLogger,
    transport: Transport = smtpTransport,
    audit?: AuditSink,
  ) {
    this.resolveConfig = resolveConfig
    this.logger = logger
    this.transport = transport
    this.audit = audit
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
      await this.transport(cfg, msg)
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
