/**
 * 会话密钥面板（复用件）：会话级密钥的列表/增删 + 全局与继承变量的
 * 会话内屏蔽开关。两个宿主共用——overlay 槽的面板宿主（/secret 命令唤起，
 * 传 onClose）与设置页的会话管理区（选择会话后内嵌，无头栏）。
 * 值只经同源端点下行，绝不回显。
 * @module secret-env/client/panel
 */

import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconEye,
  IconEyeOff,
  IconRefreshOutline16,
  IconTrashOutline16,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useRef, useState } from 'react'

import {
  fetchSecrets,
  type GlobalWireEntry,
  type InheritedWireEntry,
  type SecretList,
  type SessionWireEntry,
  setMask,
  setSession,
  unsetSession,
} from './api.ts'
import { copyText, errorText, liveName, nameErrorOf } from './common.ts'

export interface SessionSecretsPanelProps {
  sessionId: string
  t(key: string): string
  /** 提供时渲染头栏（标题/刷新/关闭），供 overlay 弹层模式使用。 */
  onClose?(): void
}

interface FormState {
  name: string
  value: string
  description: string
  once: boolean
}

const EMPTY_FORM: FormState = { name: '', value: '', description: '', once: false }

/** 复制按钮（复制成功短暂亮勾）。 */
function CopyButton(props: { t(key: string): string; text: string }): ReactElement {
  const { t } = props
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <button
      type="button"
      className="dse-iconBtn"
      title={t('copy')}
      aria-label={t('copy')}
      onClick={() => {
        void copyText(props.text).then((ok) => {
          if (!ok) return
          setCopied(true)
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
    </button>
  )
}

/** 会话内屏蔽开关（眼睛语义：可见=注入，划掉=本会话屏蔽）。 */
function MaskToggle(props: {
  t(key: string): string
  masked: boolean
  onToggle(): void
}): ReactElement {
  const { t, masked } = props
  return (
    <button
      type="button"
      className={`dse-iconBtn dse-maskBtn${masked ? ' dse-maskBtnOn' : ''}`}
      title={masked ? t('unmaskSession') : t('maskSession')}
      aria-label={masked ? t('unmaskSession') : t('maskSession')}
      aria-pressed={masked}
      onClick={props.onToggle}
    >
      {masked ? <IconEyeOff size={14} /> : <IconEye size={14} />}
    </button>
  )
}

function SessionRow(props: {
  t: SessionSecretsPanelProps['t']
  sessionId: string
  entry: SessionWireEntry
  onChanged(): void
  onError(text: string): void
}): ReactElement {
  const { t, entry } = props
  return (
    <div className="dse-row">
      <div className="dse-rowMain">
        <div className="dse-env">
          <span className="dse-envName">${entry.envName}</span>
          <CopyButton t={t} text={`$${entry.envName}`} />
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
              .then(() => props.onChanged())
              .catch((error: unknown) => props.onError(errorText(t, error)))
          }}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </div>
    </div>
  )
}

function GlobalRow(props: {
  t: SessionSecretsPanelProps['t']
  sessionId: string
  entry: GlobalWireEntry
  onChanged(): void
  onError(text: string): void
}): ReactElement {
  const { t, entry } = props
  return (
    <div className="dse-row">
      <div className="dse-rowMain">
        <div className="dse-env">
          <span className={`dse-envName${entry.masked ? ' dse-envNameDim' : ''}`}>
            ${entry.envName}
          </span>
          <CopyButton t={t} text={`$${entry.envName}`} />
        </div>
        {entry.description !== '' ? <span className="dse-note">{entry.description}</span> : null}
      </div>
      <div className="dse-badges">
        {entry.masked ? <span className="dse-badge">{t('maskedBadge')}</span> : null}
        <MaskToggle
          t={t}
          masked={entry.masked}
          onToggle={() => {
            setMask(entry.name, !entry.masked, props.sessionId)
              .then(() => props.onChanged())
              .catch((error: unknown) => props.onError(errorText(t, error)))
          }}
        />
      </div>
    </div>
  )
}

function InheritedRow(props: {
  t: SessionSecretsPanelProps['t']
  sessionId: string
  entry: InheritedWireEntry
  onChanged(): void
  onError(text: string): void
}): ReactElement {
  const { t, entry } = props
  return (
    <div className="dse-row">
      <div className="dse-rowMain">
        <div className="dse-env">
          <span className={`dse-envName${entry.masked ? ' dse-envNameDim' : ''}`}>
            ${entry.envName}
          </span>
          <CopyButton t={t} text={`$${entry.envName}`} />
        </div>
        <span className="dse-note">{t('inheritedNote')}</span>
      </div>
      <div className="dse-badges">
        {entry.globallyMasked ? (
          <span className="dse-badge dse-badgeDim">{t('maskedGlobalBadge')}</span>
        ) : (
          <>
            {entry.masked ? <span className="dse-badge">{t('maskedBadge')}</span> : null}
            <MaskToggle
              t={t}
              masked={entry.masked}
              onToggle={() => {
                setMask(entry.name, !entry.masked, props.sessionId)
                  .then(() => props.onChanged())
                  .catch((error: unknown) => props.onError(errorText(t, error)))
              }}
            />
          </>
        )}
      </div>
    </div>
  )
}

export function SessionSecretsPanel(props: SessionSecretsPanelProps): ReactElement {
  const { sessionId, t } = props
  const [data, setData] = useState<SecretList | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const load = (): void => {
    fetchSecrets(sessionId)
      .then((list) => setData(list))
      .catch(() => setStatus(errorText(t, new Error('internal'))))
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load 为闭包稳定函数，仅需随会话切换重取
  useEffect(() => {
    load()
  }, [sessionId])

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

  const onError = (text: string): void => setStatus(text === '' ? null : text)
  const nameError = nameErrorOf(form.name)
  const canSave = form.name.trim() !== '' && nameError === null && form.value !== '' && !saving

  return (
    <div className="dse-panel">
      {props.onClose !== undefined ? (
        <div className="dse-popHead">
          <p className="dse-popTitle">{t('sessionSecrets')}</p>
          <button
            type="button"
            className="dse-iconBtn"
            title={t('refresh')}
            aria-label={t('refresh')}
            onClick={load}
          >
            <IconRefreshOutline16 size={14} />
          </button>
          <button
            type="button"
            className="dse-iconBtn"
            title={t('close')}
            aria-label={t('close')}
            onClick={props.onClose}
          >
            <IconCloseOutline16 size={14} />
          </button>
        </div>
      ) : null}
      <p className="dse-popHint">{t('sessionHint')}</p>
      {status !== null ? <p className="dse-status dse-statusError">{status}</p> : null}

      <h4 className="dse-groupLabel">{t('sessionList')}</h4>
      <div className="dse-popList">
        {data === null || data.session.length === 0 ? (
          <p className="dse-empty">{t('sessionEmpty')}</p>
        ) : (
          data.session.map((entry) => (
            <SessionRow
              key={entry.name}
              t={t}
              sessionId={sessionId}
              entry={entry}
              onChanged={load}
              onError={onError}
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
            className={`dse-input${nameError !== null ? ' dse-inputError' : ''}`}
            placeholder="API_TOKEN"
            value={form.name}
            aria-invalid={nameError !== null}
            onChange={(event) => setForm({ ...form, name: liveName(event.target.value) })}
          />
          {nameError !== null ? (
            <p className="dse-hint dse-hintError">{t('error.invalid-name')}</p>
          ) : null}
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

      {data !== null && data.global.length > 0 ? (
        <>
          <h4 className="dse-groupLabel">{t('globalInSession')}</h4>
          <div className="dse-popList">
            {data.global.map((entry) => (
              <GlobalRow
                key={entry.name}
                t={t}
                sessionId={sessionId}
                entry={entry}
                onChanged={load}
                onError={onError}
              />
            ))}
          </div>
        </>
      ) : null}

      {data !== null && data.inherited.length > 0 ? (
        <>
          <h4 className="dse-groupLabel">{t('inheritedInSession')}</h4>
          <div className="dse-popList">
            {data.inherited.map((entry) => (
              <InheritedRow
                key={entry.name}
                t={t}
                sessionId={sessionId}
                entry={entry}
                onChanged={load}
                onError={onError}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
