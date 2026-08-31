/**
 * 密钥变量设置页（settings.section 官方插槽）：全局密钥的列表与增删。
 * 只展示元数据与模型可见的完整变量名——值写入后不可回读（端点不出值）。
 * 响应式：≤767px 行转堆叠卡、表单转单列。
 * @module secret-env/client/section
 */
import { type ReactElement, useEffect, useRef, useState } from 'react'

import { ApiError, fetchSecrets, type SecretList, setGlobal, unsetGlobal } from './api.ts'
import { copyText, errorText } from './common.ts'

export interface SectionProps {
  t(key: string): string
}

interface FormState {
  name: string
  value: string
  description: string
}

const EMPTY_FORM: FormState = { name: '', value: '', description: '' }

/** 单行：完整变量名（复制）+ 描述 + 状态徽标 + 两步删除。 */
function GlobalRow(props: {
  t: SectionProps['t']
  entry: SecretList['global'][number]
  onDeleted(): void
  onError(text: string): void
}): ReactElement {
  const { t, entry } = props
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const onCopy = (): void => {
    void copyText(`$${entry.envName}`).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  const onDelete = (): void => {
    unsetGlobal(entry.name)
      .then(() => props.onDeleted())
      .catch((error: unknown) => props.onError(errorText(t, error)))
  }

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
            onClick={onCopy}
          >
            {copied ? '✓' : '⧉'}
          </button>
        </div>
        {entry.description !== '' ? <span className="dse-note">{entry.description}</span> : null}
      </div>
      <div className="dse-badges">
        <span className={`dse-badge${entry.configured ? '' : ' dse-badgeDim'}`}>
          {entry.configured ? t('configured') : t('unconfigured')}
        </span>
        {entry.writable ? null : (
          <span className="dse-badge dse-badgeDim" title={entry.source ?? ''}>
            {t('readonly')}
          </span>
        )}
        {confirming ? (
          <>
            <button type="button" className="dse-btn dse-btnPrimary" onClick={onDelete}>
              {t('delete')}
            </button>
            <button
              type="button"
              className="dse-btn dse-btnGhost"
              onClick={() => setConfirming(false)}
            >
              {t('close')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="dse-iconBtn dse-delBtn"
            title={t('delete')}
            aria-label={t('delete')}
            onClick={() => setConfirming(true)}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export function SecretsSection(props: SectionProps): ReactElement {
  const { t } = props
  const [data, setData] = useState<SecretList | null>(null)
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = (): void => {
    fetchSecrets()
      .then((list) => {
        setData(list)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load 为闭包稳定函数（读端点后 setState），仅需首载一次
  useEffect(() => {
    load()
  }, [])

  const onSave = (): void => {
    setSaving(true)
    setStatus(null)
    setGlobal(form.name, form.value, form.description)
      .then(() => {
        setForm(EMPTY_FORM)
        setStatus({ kind: 'ok', text: t('configured') })
        load()
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'err',
          text: errorText(t, error instanceof ApiError ? error : new ApiError('internal')),
        })
      })
      .finally(() => setSaving(false))
  }

  if (data === null) {
    return (
      <div className="dse-section">
        <p className="dse-empty">{failed ? t('loadFailed') : '…'}</p>
        {failed ? (
          <button type="button" className="dse-btn dse-btnGhost" onClick={load}>
            {t('retry')}
          </button>
        ) : null}
      </div>
    )
  }

  const canSave = form.name.trim() !== '' && form.value !== '' && !saving
  return (
    <div className="dse-section">
      <header className="dse-head">
        <h2 className="dse-title">{t('title')}</h2>
        <p className="dse-desc">{t('description')}</p>
      </header>

      <h3 className="dse-groupLabel">{t('globalList')}</h3>
      <div className="dse-rows">
        {data.global.length === 0 ? (
          <p className="dse-empty">{t('emptyGlobal')}</p>
        ) : (
          data.global.map((entry) => (
            <GlobalRow
              key={entry.name}
              t={t}
              entry={entry}
              onDeleted={load}
              onError={(text) => setStatus({ kind: 'err', text })}
            />
          ))
        )}
      </div>

      <h3 className="dse-groupLabel">{t('addGlobal')}</h3>
      <div className="dse-form">
        <div className="dse-formGrid">
          <div className="dse-field">
            <div className="dse-head">
              <label className="dse-label" htmlFor="dse-name">
                {t('nameLabel')}
              </label>
            </div>
            <input
              id="dse-name"
              className="dse-input"
              value={form.name}
              placeholder="GITHUB_TOKEN"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <p className="dse-hint">{t('nameHint')}</p>
          </div>
          <div className="dse-field">
            <div className="dse-head">
              <label className="dse-label" htmlFor="dse-value">
                {t('valueLabel')}
              </label>
            </div>
            <input
              id="dse-value"
              className="dse-input"
              type="password"
              autoComplete="off"
              value={form.value}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
            />
            <p className="dse-hint">{t('valueHint')}</p>
          </div>
        </div>
        <div className="dse-field">
          <div className="dse-head">
            <label className="dse-label" htmlFor="dse-desc">
              {t('descLabel')}
            </label>
          </div>
          <input
            id="dse-desc"
            className="dse-input"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <p className="dse-hint">{t('descHint')}</p>
        </div>
        <div className="dse-foot">
          {status !== null ? (
            <p className={`dse-status${status.kind === 'err' ? ' dse-statusError' : ''}`}>
              {status.text}
            </p>
          ) : null}
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
  )
}
