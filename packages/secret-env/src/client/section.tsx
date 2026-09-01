/**
 * 环境变量设置页（settings.section 官方插槽）：
 * - 全局变量：列表与增删（值写入后不可回读，端点不出值）；
 * - 继承变量：识别宿主进程环境的 DSH_VAR_*（默认纳入注入），可全局屏蔽；
 * - 会话变量：经会话选择器内嵌会话面板（会话级/一次性变量的增删与屏蔽）。
 * 只展示元数据与模型可见的完整变量名。响应式：≤767px 行转堆叠卡、表单单列。
 * @module secret-env/client/section
 */

import {
  IconCheckOutline16,
  IconCopyOutline16,
  IconEye,
  IconEyeOff,
  IconTrashOutline16,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  ApiError,
  fetchSecrets,
  type GlobalWireEntry,
  type InheritedWireEntry,
  type SecretList,
  setGlobal,
  setMask,
  unsetGlobal,
} from './api.ts'
import { copyText, errorText, liveName, nameErrorOf } from './common.ts'
import { SessionSecretsPanel } from './panel.tsx'

/** sessions 服务的列表快照面（结构子集；ObservableSnapshot 契约）。 */
export interface SessionsListLike {
  list: {
    getSnapshot(): { current?: string; byId: Record<string, { id: string; displayTitle: string }> }
    subscribe(listener: () => void): () => void
  }
  refresh(): Promise<void>
}

export interface SectionProps {
  t(key: string): string
  sessions?: SessionsListLike
}

interface FormState {
  name: string
  value: string
  description: string
}

const EMPTY_FORM: FormState = { name: '', value: '', description: '' }

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

/** 全局变量行：完整变量名（复制）+ 描述 + 状态徽标 + 两步删除。 */
function GlobalRow(props: {
  t: SectionProps['t']
  entry: GlobalWireEntry
  onDeleted(): void
  onError(text: string): void
}): ReactElement {
  const { t, entry } = props
  const [confirming, setConfirming] = useState(false)

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
          <CopyButton t={t} text={`$${entry.envName}`} />
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
            <IconTrashOutline16 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

/** 继承变量行：来源说明 + 全局屏蔽开关（眼睛语义）。 */
function InheritedRow(props: {
  t: SectionProps['t']
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
        {entry.masked ? <span className="dse-badge">{t('maskedBadge')}</span> : null}
        <button
          type="button"
          className={`dse-iconBtn dse-maskBtn${entry.masked ? ' dse-maskBtnOn' : ''}`}
          title={entry.masked ? t('unmaskGlobal') : t('maskGlobal')}
          aria-label={entry.masked ? t('unmaskGlobal') : t('maskGlobal')}
          aria-pressed={entry.masked}
          onClick={() => {
            setMask(entry.name, !entry.masked)
              .then(() => props.onChanged())
              .catch((error: unknown) => props.onError(errorText(t, error)))
          }}
        >
          {entry.masked ? <IconEyeOff size={14} /> : <IconEye size={14} />}
        </button>
      </div>
    </div>
  )
}

/** 会话变量管理块：会话选择器 + 内嵌会话面板。 */
function SessionManageBlock(props: {
  t: SectionProps['t']
  sessions: SessionsListLike
}): ReactElement {
  const { t, sessions } = props
  const snapshot = useSyncExternalStore(
    (listener) => sessions.list.subscribe(listener),
    () => sessions.list.getSnapshot(),
  )
  const [picked, setPicked] = useState<string>('')

  // 首载刷新一次宿主权威列表。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅需挂载时一次
  useEffect(() => {
    void sessions.refresh().catch(() => {})
  }, [])

  const rows = Object.values(snapshot.byId)
  const current = rows.find((row) => row.id === picked)?.id ?? snapshot.current ?? rows[0]?.id ?? ''

  return (
    <>
      <h3 className="dse-groupLabel">{t('sessionManage')}</h3>
      <div className="dse-form">
        {rows.length === 0 ? (
          <p className="dse-empty">{t('sessionPickEmpty')}</p>
        ) : (
          <>
            <div className="dse-field">
              <div className="dse-head">
                <label className="dse-label" htmlFor="dse-session-pick">
                  {t('sessionPick')}
                </label>
              </div>
              <select
                id="dse-session-pick"
                className="dse-input"
                value={current}
                onChange={(event) => setPicked(event.target.value)}
              >
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.displayTitle}
                  </option>
                ))}
              </select>
            </div>
            {current !== '' ? (
              <SessionSecretsPanel key={current} sessionId={current} t={t} />
            ) : null}
          </>
        )}
      </div>
    </>
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

  const nameError = nameErrorOf(form.name)
  const canSave = form.name.trim() !== '' && nameError === null && form.value !== '' && !saving
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

      <h3 className="dse-groupLabel">{t('inheritedList')}</h3>
      <div className="dse-rows">
        {data.inherited.length === 0 ? (
          <p className="dse-empty">{t('inheritedEmpty')}</p>
        ) : (
          data.inherited.map((entry) => (
            <InheritedRow
              key={entry.name}
              t={t}
              entry={entry}
              onChanged={load}
              onError={(text) => setStatus({ kind: 'err', text })}
            />
          ))
        )}
      </div>

      {props.sessions !== undefined ? <SessionManageBlock t={t} sessions={props.sessions} /> : null}

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
              className={`dse-input${nameError !== null ? ' dse-inputError' : ''}`}
              value={form.name}
              placeholder="GITHUB_TOKEN"
              aria-invalid={nameError !== null}
              onChange={(event) => setForm({ ...form, name: liveName(event.target.value) })}
            />
            <p className={`dse-hint${nameError !== null ? ' dse-hintError' : ''}`}>
              {nameError !== null ? t('error.invalid-name') : t('nameHint')}
            </p>
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
