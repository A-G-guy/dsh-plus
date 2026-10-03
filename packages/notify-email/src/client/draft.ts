/**
 * 卡片草稿模型与纯校验（无 React/JSX，供 node --test 直接导入）：
 * 脱敏解析值 → 草稿、草稿 → 提交形状、触发键表与正整数判定。
 * @module notify-email/client/draft
 */

/** settings 命名空间的脱敏解析值（smtp.pass 被脱敏剥除）。 */
export interface ConfigValue {
  enabled: boolean
  smtp: {
    host: string
    port: number
    secure: boolean
    user: string
    from: string
  }
  to: string[]
  triggers: {
    onComplete: boolean
    onError: boolean
    onAborted: boolean
    onQuestion: boolean
    onPlanReview: boolean
  }
  idleDebounceMs: number
  maxBodyChars: number
  dryRun: boolean
}

/** 编辑草稿：数值字段以文本承载（保存时校验并折算）。 */
export interface Draft {
  enabled: boolean
  host: string
  port: string
  secure: boolean
  user: string
  pass: string
  from: string
  toText: string
  triggers: ConfigValue['triggers']
  idleDebounceMs: string
  maxBodyChars: string
  dryRun: boolean
}

/** 通知触发点（key 同时是 i18n 文案键与 settings 字段名）。 */
export const TRIGGER_KEYS = [
  'onComplete',
  'onError',
  'onAborted',
  'onQuestion',
  'onPlanReview',
] as const

export type TriggerKey = (typeof TRIGGER_KEYS)[number]

export function isPositiveInt(text: string): boolean {
  return /^[0-9]+$/.test(text) && Number(text) > 0
}

export function draftFromValue(value: ConfigValue): Draft {
  return {
    enabled: value.enabled,
    host: value.smtp.host,
    port: String(value.smtp.port),
    secure: value.smtp.secure,
    user: value.smtp.user,
    pass: '',
    from: value.smtp.from,
    toText: value.to.join(', '),
    triggers: { ...value.triggers },
    idleDebounceMs: String(value.idleDebounceMs),
    maxBodyChars: String(value.maxBodyChars),
    dryRun: value.dryRun,
  }
}

/** 草稿 → 提交形状（pass 为空表示「保持已存密钥」，由调用方剔除该键）。 */
export function toPatch(draft: Draft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    smtp: {
      host: draft.host.trim(),
      port: Number(draft.port),
      secure: draft.secure,
      user: draft.user.trim(),
      pass: draft.pass,
      from: draft.from.trim(),
    },
    to: draft.toText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    triggers: { ...draft.triggers },
    idleDebounceMs: Number(draft.idleDebounceMs),
    maxBodyChars: Number(draft.maxBodyChars),
    dryRun: draft.dryRun,
  }
}
