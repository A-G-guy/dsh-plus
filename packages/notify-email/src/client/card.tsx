/**
 * 「邮件通知」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 交互对齐官方卡片：折叠/展开、staged draft、未保存标记、保存/放弃；
 * 另加「发送测试邮件」。数据走自建同源路由（api.ts）。
 * @module notify-email/client/card
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'

import {
  fetchConfig, saveConfig, sendTest, type WireConfig, type WirePatch, type WireTriggers,
} from './api.ts'
import { CheckRow, TextField } from './fields.tsx'

export interface CardProps {
  t(key: string): string
}

interface Draft {
  enabled: boolean
  host: string
  port: string
  secure: boolean
  user: string
  pass: string
  from: string
  toText: string
  triggers: WireTriggers
  idleDebounceMs: string
  maxBodyChars: string
  dryRun: boolean
}

interface Status {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

const IDLE_STATUS: Status = { kind: 'idle', text: '' }

function draftFromWire(wire: WireConfig): Draft {
  return {
    enabled: wire.enabled,
    host: wire.smtp.host,
    port: String(wire.smtp.port),
    secure: wire.smtp.secure,
    user: wire.smtp.user,
    pass: '',
    from: wire.smtp.from,
    toText: wire.to.join(', '),
    triggers: { ...wire.triggers },
    idleDebounceMs: String(wire.idleDebounceMs),
    maxBodyChars: String(wire.maxBodyChars),
    dryRun: wire.dryRun,
  }
}

function isPositiveInt(text: string): boolean {
  return /^[0-9]+$/.test(text) && Number(text) > 0
}

function toPatch(draft: Draft): WirePatch {
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
    to: draft.toText.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
    triggers: { ...draft.triggers },
    idleDebounceMs: Number(draft.idleDebounceMs),
    maxBodyChars: Number(draft.maxBodyChars),
    dryRun: draft.dryRun,
  }
}

const TRIGGER_KEYS = ['onComplete', 'onError', 'onAborted', 'onQuestion', 'onPlanReview'] as const

export function NotifyEmailCard(props: CardProps): ReactElement | null {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [wire, setWire] = useState<WireConfig | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<Status>(IDLE_STATUS)

  useEffect(() => {
    let alive = true
    fetchConfig()
      .then((loaded) => {
        if (!alive) return
        setWire(loaded)
        setDraft(draftFromWire(loaded))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const dirty = useMemo(
    () => wire !== null && draft !== null && JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFromWire(wire))),
    [wire, draft],
  )
  const invalid = useMemo(
    () =>
      draft !== null &&
      (!isPositiveInt(draft.port) || !isPositiveInt(draft.idleDebounceMs) ||
        !isPositiveInt(draft.maxBodyChars) || Number(draft.maxBodyChars) < 200),
    [draft],
  )

  if (failed) return null
  if (wire === null || draft === null) {
    return <li className="dne-card"><p className="dne-readOnly">{t('loading')}</p></li>
  }
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft({ ...draft, [key]: value })
    setStatus(IDLE_STATUS)
  }
  const editTrigger = (key: keyof WireTriggers, checked: boolean): void => {
    edit('triggers', { ...draft.triggers, [key]: checked })
  }
  const onSave = (): void => {
    setSaving(true)
    saveConfig(toPatch(draft))
      .then((saved) => {
        setWire(saved)
        setDraft(draftFromWire(saved))
        setStatus(IDLE_STATUS)
      })
      .catch((error: unknown) => {
        setStatus({ kind: 'error', text: `${t('saveFailed')} ${error instanceof Error ? error.message : ''}` })
      })
      .finally(() => setSaving(false))
  }
  const onTest = (): void => {
    setTesting(true)
    sendTest()
      .then((result) => {
        if (result.ok) {
          setStatus({ kind: 'ok', text: result.detail === 'dry-run' ? t('testDryRun') : t('testOk') })
        } else {
          const why = result.detail === 'incomplete' ? t('incomplete') : result.detail
          setStatus({ kind: 'error', text: `${t('testFailed')}${why}` })
        }
      })
      .catch((error: unknown) => {
        setStatus({ kind: 'error', text: `${t('testFailed')}${error instanceof Error ? error.message : ''}` })
      })
      .finally(() => setTesting(false))
  }

  const disabled = !wire.writable
  return (
    <li className={`dne-card${open ? ' dne-cardOpen' : ''}`}>
      <button
        type="button"
        className="dne-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => setOpen(!open)}
      >
        <span className="dne-headText">
          <span className="dne-name">{t('title')}</span>
          <span className="dne-description">{t('description')}</span>
        </span>
        {dirty ? <span className="dne-pending">{t('unsaved')}</span> : null}
        <span className={`dne-chevron${open ? ' dne-chevronOpen' : ''}`}>▾</span>
      </button>
      {open ? (
        <div className="dne-body">
          {disabled ? <p className="dne-readOnly" role="status">{t('readOnly')}</p> : null}
          <CheckRow id="dne-enabled" label={t('enabled')} checked={draft.enabled} disabled={disabled}
            onEdit={(v) => edit('enabled', v)} />
          <TextField id="dne-host" label={t('host')} hint={t('hostHint')} value={draft.host}
            disabled={disabled} onEdit={(v) => edit('host', v)} />
          <TextField id="dne-port" label={t('port')} hint={t('portHint')} value={draft.port} numeric
            disabled={disabled} invalid={!isPositiveInt(draft.port)} invalidLabel={t('invalidNumber')}
            onEdit={(v) => edit('port', v)} />
          <CheckRow id="dne-secure" label={t('secure')} checked={draft.secure} disabled={disabled}
            onEdit={(v) => edit('secure', v)} />
          <TextField id="dne-user" label={t('user')} hint={t('userHint')} value={draft.user}
            disabled={disabled} onEdit={(v) => edit('user', v)} />
          <TextField id="dne-pass" label={t('pass')} hint={t('passHint')} value={draft.pass} password
            disabled={disabled}
            badge={{ text: wire.smtp.passConfigured ? t('passSet') : t('passUnset'), set: wire.smtp.passConfigured }}
            onEdit={(v) => edit('pass', v)} />
          <TextField id="dne-from" label={t('from')} hint={t('fromHint')} value={draft.from}
            disabled={disabled} onEdit={(v) => edit('from', v)} />
          <TextField id="dne-to" label={t('to')} hint={t('toHint')} value={draft.toText}
            disabled={disabled} onEdit={(v) => edit('toText', v)} />
          <p className="dne-groupLabel">{t('triggerGroup')}</p>
          {TRIGGER_KEYS.map((key) => (
            <CheckRow key={key} id={`dne-${key}`} label={t(key)} checked={draft.triggers[key]}
              disabled={disabled} onEdit={(v) => editTrigger(key, v)} />
          ))}
          <TextField id="dne-debounce" label={t('idleDebounceMs')} hint={t('idleDebounceMsHint')}
            value={draft.idleDebounceMs} numeric disabled={disabled}
            invalid={!isPositiveInt(draft.idleDebounceMs)} invalidLabel={t('invalidNumber')}
            onEdit={(v) => edit('idleDebounceMs', v)} />
          <TextField id="dne-maxchars" label={t('maxBodyChars')} hint={t('maxBodyCharsHint')}
            value={draft.maxBodyChars} numeric disabled={disabled}
            invalid={!isPositiveInt(draft.maxBodyChars) || Number(draft.maxBodyChars) < 200}
            invalidLabel={t('invalidNumber')}
            onEdit={(v) => edit('maxBodyChars', v)} />
          <CheckRow id="dne-dryrun" label={t('dryRun')} checked={draft.dryRun} disabled={disabled}
            onEdit={(v) => edit('dryRun', v)} />
          <div className="dne-footer">
            {status.kind !== 'idle' ? (
              <p className={`dne-status${status.kind === 'error' ? ' dne-statusError' : ''}`} role="status">
                {status.text}
              </p>
            ) : null}
            <button type="button" className="dne-btn dne-btnGhost" disabled={testing}
              onClick={onTest}>
              {t(testing ? 'testing' : 'test')}
            </button>
            <button type="button" className="dne-btn dne-btnGhost" disabled={!dirty || saving}
              onClick={() => { setDraft(draftFromWire(wire)); setStatus(IDLE_STATUS) }}>
              {t('discard')}
            </button>
            <button type="button" className="dne-btn dne-btnPrimary" disabled={!dirty || invalid || saving || disabled}
              onClick={onSave}>
              {t(saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
