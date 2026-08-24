/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用，与官方卡片同机制。
 * 公共键（save/discard/unsaved 等）来自 shared 的 common 字典，本文件只维护业务键。
 * @module notify-email/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-notify-email'

const ownZh = {
  title: '邮件通知',
  description: '任务结束、等待决策或出错时向指定邮箱发送邮件。',
  enabled: '启用通知',
  host: 'SMTP 服务器',
  hostHint: '如 smtp.qq.com、smtp.163.com。',
  port: '端口',
  portHint: '465（TLS）或 587（STARTTLS）。',
  secure: 'TLS 直连',
  user: '登录用户名',
  userHint: '通常为发件邮箱地址；免认证服务器可留空。',
  pass: '密码 / 授权码',
  passHint: '留空表示保持已存密码不变。',
  passSet: '已配置',
  passUnset: '未配置',
  from: '发件地址',
  fromHint: '邮件 From 头，通常与登录用户名一致。',
  to: '收件邮箱',
  toHint: '多个收件人用英文逗号分隔。',
  triggerGroup: '通知时机',
  onComplete: '任务执行完毕',
  onError: '报错 / 失败停止',
  onAborted: '被用户取消',
  onQuestion: '提问等待回答',
  onPlanReview: 'Plan 待审批',
  idleDebounceMs: '空闲确认（毫秒）',
  idleDebounceMsHint: '任务结束后等待该时长确认无后续工作再发信。',
  maxBodyChars: '正文截断长度',
  maxBodyCharsHint: '邮件正文内容超过该长度时截断。',
  dryRun: '仅记录日志（不真实发送）',
  test: '发送测试邮件',
  testing: '发送中…',
  testOk: '测试邮件已发送。',
  testDryRun: '已按 dry-run 记录日志（未真实发送）。',
  testFailed: '测试发送失败：',
  incomplete: 'SMTP 配置不完整（服务器/发件地址/收件人必填）。',
}

const ownEn = {
  title: 'Email notifications',
  description: 'Email a mailbox when a task finishes, awaits a decision, or fails.',
  enabled: 'Enable notifications',
  host: 'SMTP host',
  hostHint: 'e.g. smtp.qq.com, smtp.gmail.com.',
  port: 'Port',
  portHint: '465 (TLS) or 587 (STARTTLS).',
  secure: 'Direct TLS',
  user: 'Username',
  userHint: 'Usually the sender address; leave empty for auth-less servers.',
  pass: 'Password / app token',
  passHint: 'Leave blank to keep the stored password.',
  passSet: 'Configured',
  passUnset: 'Not configured',
  from: 'From address',
  fromHint: 'The From header, usually same as the username.',
  to: 'Recipients',
  toHint: 'Separate multiple recipients with commas.',
  triggerGroup: 'Notify when',
  onComplete: 'Task completed',
  onError: 'Task failed',
  onAborted: 'Cancelled by user',
  onQuestion: 'Question awaiting answer',
  onPlanReview: 'Plan awaiting review',
  idleDebounceMs: 'Idle debounce (ms)',
  idleDebounceMsHint: 'After completion, wait this long to confirm no follow-up before sending.',
  maxBodyChars: 'Body truncation length',
  maxBodyCharsHint: 'Truncate the email body beyond this length.',
  dryRun: 'Log only (do not actually send)',
  test: 'Send test email',
  testing: 'Sending…',
  testOk: 'Test email sent.',
  testDryRun: 'Logged in dry-run mode (not sent).',
  testFailed: 'Test send failed: ',
  incomplete: 'SMTP config incomplete (host/from/recipients required).',
}

export const zh: Record<string, string> = mergeDict(commonZh, ownZh)
export const en: Record<string, string> = mergeDict(commonEn, ownEn)
