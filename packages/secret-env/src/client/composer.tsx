/**
 * 会话注入控件（conversation.input.right 官方插槽，session 作用域）：
 * composer 工具行的钥匙胶囊，弹出本会话的会话级密钥面板（列表 + 增删）。
 * 会话 id 由插槽 inject 工厂直接供给（框架解析的严格 session 作用域）。
 * 窄屏（≤767px）popover 转底部抽屉；桌面点外部或 Esc 关闭。
 * @module secret-env/client/composer
 */
import { type ReactElement, useEffect, useRef, useState } from 'react'

import { fetchSecrets, type SessionWireEntry, setSession, unsetSession } from './api.ts'
import { copyText, errorText } from './common.ts'

export interface ComposerSecretProps {
  /** 插槽 inject 工厂注入的当前会话 id（严格 session 作用域，必存在）。 */
  sessionId: string
  t(key: string): string
}

interface FormState {
  name: string
  value: string
  description: string
  once: boolean
}

const EMPTY_FORM: FormState = { name: '', value: '', description: '', once: false }

function SessionRow(props: {
  t: ComposerSecretProps['t']
  sessionId: string
  entry: SessionWireEntry
  onDeleted(): void
  onError(text: string): void
}): ReactElement {
  const { t, entry } = props
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <div className="dse-row">
      <div className="dse-rowMain">
        <div className="dse-env">
          <span className="dse-envName">${entry.envName}</span>
          <button
            type="button"
            className="dse-iconBtn"
            title={t('copy')}
            aria-label={t('copy')}
            onClick={() => {
              void copyText(`$${entry.envName}`).then((ok) => {
                if (!ok) return
                setCopied(true)
                if (timer.current !== null) clearTimeout(timer.current)
                timer.current = setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? '✓' : '⧉'}
          </button>
        </div>
        {entry.description !== '' ? <span className="dse-note">{entry.description}</span> : null}
      </div>
      <div className="dse-badges">
        {entry.once ? <span className="dse-badge">{t('scopeOnce')}</span> : null}
        <button
          type="button"
          className="dse-iconBtn dse-delBtn"
          title={t('delete')}
          aria-label={t('delete')}
          onClick={() => {
            unsetSession(props.sessionId, entry.name)
              .then(() => props.onDeleted())
              .catch((error: unknown) => props.onError(errorText(t, error)))
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export function ComposerSecret(props: ComposerSecretProps): ReactElement {
  const { sessionId, t } = props
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SessionWireEntry[] | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const wrapRef = useRef<HTMLSpanElement | null>(null)

  const load = (): void => {
    fetchSecrets(sessionId)
      .then((list) => setItems(list.session))
      .catch(() => setStatus(errorText(t, new Error('internal'))))
  }

  // 打开面板与会话切换时拉取；闭合计时清零。
  // biome-ignore lint/correctness/useExhaustiveDependencies: load 为闭包稳定函数，仅需随 open/sessionId 触发
  useEffect(() => {
    if (!open) return
    load()
  }, [open, sessionId])

  // 桌面：点外部 / Esc 关闭。
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onSave = (): void => {
    setSaving(true)
    setStatus(null)
    setSession(sessionId, form.name, form.value, form.description, form.once)
      .then(() => {
        setForm(EMPTY_FORM)
        load()
      })
      .catch((error: unknown) => setStatus(errorText(t, error)))
      .finally(() => setSaving(false))
  }

  const count = items?.length ?? 0
  const canSave = form.name.trim() !== '' && form.value !== '' && !saving

  return (
    <span className="dse-wrap" ref={wrapRef}>
      <button
        type="button"
        className="dse-chip"
        aria-expanded={open}
        aria-label={t('sessionSecrets')}
        title={t('sessionSecrets')}
        onClick={() => setOpen(!open)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M14.5 2a7.5 7.5 0 0 0-7.36 9.04L2 20.19V22h1.81l1.5-1.5v-1.81h1.81v-1.81h1.81l1.22-1.22A7.5 7.5 0 1 0 14.5 2Zm2 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"
            fill="currentColor"
          />
        </svg>
        {count > 0 ? <span className="dse-count">{count}</span> : null}
      </button>
      {open ? (
        <div className="dse-pop" role="dialog" aria-label={t('sessionSecrets')}>
          <div className="dse-popHead">
            <p className="dse-popTitle">{t('sessionSecrets')}</p>
            <button
              type="button"
              className="dse-iconBtn"
              title={t('refresh')}
              aria-label={t('refresh')}
              onClick={load}
            >
              ⟳
            </button>
            <button
              type="button"
              className="dse-iconBtn"
              title={t('close')}
              aria-label={t('close')}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <p className="dse-popHint">{t('sessionHint')}</p>
          <div className="dse-popList">
            {items === null || items.length === 0 ? (
              <p className="dse-empty">{t('sessionEmpty')}</p>
            ) : (
              items.map((entry) => (
                <SessionRow
                  key={entry.name}
                  t={t}
                  sessionId={sessionId}
                  entry={entry}
                  onDeleted={load}
                  onError={(text) => setStatus(text === '' ? null : text)}
                />
              ))
            )}
          </div>
          <div className="dse-popForm">
            <div className="dse-field">
              <div className="dse-head">
                <label className="dse-label" htmlFor="dse-s-name">
                  {t('addSession')}
                </label>
              </div>
              <input
                id="dse-s-name"
                className="dse-input"
                placeholder="API_TOKEN"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
              <input
                className="dse-input"
                type="password"
                autoComplete="off"
                placeholder={t('valueLabel')}
                value={form.value}
                onChange={(event) => setForm({ ...form, value: event.target.value })}
              />
              <input
                className="dse-input"
                placeholder={t('descLabel')}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
              <div className="dse-checkRow">
                <input
                  id="dse-s-once"
                  type="checkbox"
                  role="switch"
                  aria-checked={form.once}
                  checked={form.once}
                  onChange={(event) => setForm({ ...form, once: event.target.checked })}
                />
                <label htmlFor="dse-s-once">{t('onceLabel')}</label>
              </div>
            </div>
            <div className="dse-foot">
              {status !== null ? <p className="dse-status dse-statusError">{status}</p> : null}
              <button
                type="button"
                className="dse-btn dse-btnPrimary"
                disabled={!canSave}
                onClick={onSave}
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </span>
  )
}
