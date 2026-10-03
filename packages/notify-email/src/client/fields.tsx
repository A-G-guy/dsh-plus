/**
 * 「邮件通知」卡片的字段组：SMTP 连接字段与触发/限流字段。
 * 从 card.tsx 拆出，避免单组件过长；控件走 @dsh-plus/shared/client 套件。
 * @module notify-email/client/fields
 */

import { CheckRow, TextField } from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'

import { type Draft, isPositiveInt, TRIGGER_KEYS, type TriggerKey } from './draft.ts'
import type { Translate } from './i18n.ts'

export interface CardFieldsProps {
  t: Translate
  draft: Draft
  disabled: boolean
  /** 字段编辑（与 card.tsx 的 edit 同签名：合并式写入并清空状态行）。 */
  onEdit<K extends keyof Draft>(key: K, value: Draft[K]): void
}

/** SMTP 连接字段（密码为只写：留空保持已存密钥）。 */
export function SmtpFields(props: CardFieldsProps & { passConfigured: boolean }): ReactElement {
  const { t, draft, disabled, onEdit } = props
  return (
    <>
      <TextField
        prefix="dne"
        id="dne-host"
        label={t('host')}
        hint={t('hostHint')}
        value={draft.host}
        disabled={disabled}
        onEdit={(v) => onEdit('host', v)}
      />
      <TextField
        prefix="dne"
        id="dne-port"
        label={t('port')}
        hint={t('portHint')}
        value={draft.port}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.port)}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => onEdit('port', v)}
      />
      <CheckRow
        prefix="dne"
        id="dne-secure"
        label={t('secure')}
        checked={draft.secure}
        disabled={disabled}
        onEdit={(v) => onEdit('secure', v)}
      />
      <TextField
        prefix="dne"
        id="dne-user"
        label={t('user')}
        hint={t('userHint')}
        value={draft.user}
        disabled={disabled}
        onEdit={(v) => onEdit('user', v)}
      />
      <TextField
        prefix="dne"
        id="dne-pass"
        label={t('pass')}
        hint={t('passHint')}
        value={draft.pass}
        password
        disabled={disabled}
        badge={{
          text: props.passConfigured ? t('passSet') : t('passUnset'),
          set: props.passConfigured,
        }}
        onEdit={(v) => onEdit('pass', v)}
      />
      <TextField
        prefix="dne"
        id="dne-from"
        label={t('from')}
        hint={t('fromHint')}
        value={draft.from}
        disabled={disabled}
        onEdit={(v) => onEdit('from', v)}
      />
    </>
  )
}

/** 收件人、触发点开关与限流字段。 */
export function TriggerFields(
  props: CardFieldsProps & { onTrigger(key: TriggerKey, checked: boolean): void },
): ReactElement {
  const { t, draft, disabled, onEdit } = props
  return (
    <>
      <TextField
        prefix="dne"
        id="dne-to"
        label={t('to')}
        hint={t('toHint')}
        value={draft.toText}
        disabled={disabled}
        onEdit={(v) => onEdit('toText', v)}
      />
      <p className="dne-groupLabel">{t('triggerGroup')}</p>
      {TRIGGER_KEYS.map((key) => (
        <CheckRow
          prefix="dne"
          key={key}
          id={`dne-${key}`}
          label={t(key)}
          checked={draft.triggers[key]}
          disabled={disabled}
          onEdit={(v) => props.onTrigger(key, v)}
        />
      ))}
      <TextField
        prefix="dne"
        id="dne-debounce"
        label={t('idleDebounceMs')}
        hint={t('idleDebounceMsHint')}
        value={draft.idleDebounceMs}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.idleDebounceMs)}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => onEdit('idleDebounceMs', v)}
      />
      <TextField
        prefix="dne"
        id="dne-maxchars"
        label={t('maxBodyChars')}
        hint={t('maxBodyCharsHint')}
        value={draft.maxBodyChars}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.maxBodyChars) || Number(draft.maxBodyChars) < 200}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => onEdit('maxBodyChars', v)}
      />
      <CheckRow
        prefix="dne"
        id="dne-dryrun"
        label={t('dryRun')}
        checked={draft.dryRun}
        disabled={disabled}
        onEdit={(v) => onEdit('dryRun', v)}
      />
    </>
  )
}
