/**
 * 「访问控制」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 交互对齐官方卡片：折叠/展开、staged draft、未保存标记、保存/放弃。
 * 配置读写走官方 settingsScope 传输（scope.ts）：value 为 schema 解析后的
 * 脱敏视图（token 不出现，tokenConfigured 经 describe 的 secrets 探测），
 * 保存经 settings.update 深合并（空 token 剔除 = 保持不变）。
 * 卡片顶部「当前页面诊断」读 /dsh-plus/gate/status（本页放行原因/客户端 IP）。
 * @module access-gate/client/card
 */
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { SETTINGS_NS } from '../ns.ts'
import type { Scope, SettingsApi } from './scope.ts'

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: SettingsApi
}

/** settings 命名空间的脱敏解析值（token 被脱敏剥除）。 */
export interface ConfigValue {
  enabled: boolean
  allowedIps: string[]
  trustForwardedFor: boolean
  cookieMaxAgeHours: number
  loginFailLimit: number
  loginCooldownMs: number
}

interface Draft {
  enabled: boolean
  token: string
  allowedIpsText: string
  trustForwardedFor: boolean
  cookieMaxAgeHours: string
  loginFailLimit: string
  loginCooldownMs: string
}

interface Status {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

interface Diag {
  enabled: boolean
  verdict: string
  clientIp: string | null
  reason: string | null
  invalidEntries: string[]
  tokenConfigured: boolean
  allowedCount: number
}

const IDLE_STATUS: Status = { kind: 'idle', text: '' }

function draftFromValue(value: ConfigValue): Draft {
  return {
    enabled: value.enabled,
    token: '',
    allowedIpsText: value.allowedIps.join('\n'),
    trustForwardedFor: value.trustForwardedFor,
    cookieMaxAgeHours: String(value.cookieMaxAgeHours),
    loginFailLimit: String(value.loginFailLimit),
    loginCooldownMs: String(value.loginCooldownMs),
  }
}

function isPositiveInt(text: string): boolean {
  return /^[0-9]+$/.test(text) && Number(text) > 0
}

function toPatch(draft: Draft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    allowedIps: draft.allowedIpsText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    trustForwardedFor: draft.trustForwardedFor,
    cookieMaxAgeHours: Number(draft.cookieMaxAgeHours),
    loginFailLimit: Number(draft.loginFailLimit),
    loginCooldownMs: Number(draft.loginCooldownMs),
  }
}

/** reason 枚举 → 文案 key。 */
const REASON_KEYS: Record<string, string> = {
  local: 'diagLocal',
  'allowed-ip': 'diagAllowedIp',
  token: 'diagToken',
}

function verdictLabel(t: (key: string) => string, diag: Diag): string {
  if (!diag.enabled) return t('diagOff')
  if (diag.verdict === 'pass') return t('diagPass')
  if (diag.verdict === 'login') return t('diagLogin')
  return t('diagBlock')
}

export function AccessGateCard(props: CardProps): ReactElement | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [diag, setDiag] = useState<Diag | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(IDLE_STATUS)

  // 首次拿到解析值后播种草稿；后续 Host 更新不覆盖在途编辑（与官方 staged 表单一致）。
  useEffect(() => {
    if (value === undefined || draft !== null) return
    setDraft(draftFromValue(value))
  }, [value, draft])

  // tokenConfigured 探测：经 describe 的 secrets 列表判断。
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot 变化（保存后 revision 推进）时刻意重探 secrets 状态
  useEffect(() => {
    let alive = true
    api
      .describe({})
      .then((response) => {
        if (!alive || !response.result.ok) return
        const view = response.result.value?.namespaces.find((ns) => ns.ns === SETTINGS_NS)
        setTokenConfigured(
          view?.secrets.some((secret) => secret.path.join('.') === 'token' && secret.set) ?? false,
        )
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api, snapshot])

  // 本页诊断：读围栏状态端点（配置保存后 snapshot 推进时重读）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 配置保存后刻意重取诊断
  useEffect(() => {
    let alive = true
    fetch('/dsh-plus/gate/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: Diag | null) => {
        if (alive && body !== null) setDiag(body)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [snapshot])

  const failClosed = useMemo(
    () => value?.enabled === true && value.allowedIps.length === 0 && !tokenConfigured,
    [value, tokenConfigured],
  )
  const dirty = useMemo(
    () =>
      value !== undefined &&
      draft !== null &&
      JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFromValue(value))),
    [value, draft],
  )
  const invalid = useMemo(
    () =>
      draft !== null &&
      (!isPositiveInt(draft.cookieMaxAgeHours) ||
        !isPositiveInt(draft.loginFailLimit) ||
        !isPositiveInt(draft.loginCooldownMs)),
    [draft],
  )

  if (value === undefined || draft === null) {
    return (
      <li className="dag-card">
        <p className="dag-readOnly">{t('loading')}</p>
      </li>
    )
  }
  const edit = <K extends keyof Draft>(key: K, editValue: Draft[K]): void => {
    setDraft({ ...draft, [key]: editValue })
    setStatus(IDLE_STATUS)
  }
  const onSave = (): void => {
    setSaving(true)
    const patch = toPatch(draft)
    if (draft.token !== '') patch.token = draft.token
    const revision = scope.getSnapshot().revision
    api
      .update({
        ns: SETTINGS_NS,
        patch,
        ...(revision !== undefined ? { expectedRevision: revision } : {}),
      })
      .then(async (response) => {
        if (!response.result.ok) {
          throw new Error(response.result.error?.message ?? t('saveFailed'))
        }
        await scope.load()
        const next = scope.getSnapshot().value as ConfigValue | undefined
        if (next !== undefined) setDraft(draftFromValue(next))
        setStatus(IDLE_STATUS)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('saveFailed')}${message}` })
      })
      .finally(() => setSaving(false))
  }

  const disabled = !snapshot.writable
  return (
    <li className={`dag-card${open ? ' dag-cardOpen' : ''}`}>
      <button
        type="button"
        className="dag-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => setOpen(!open)}
      >
        <span className="dag-headText">
          <span className="dag-name">{t('title')}</span>
          <span className="dag-description">{t('description')}</span>
        </span>
        {dirty ? <span className="dag-pending">{t('unsaved')}</span> : null}
        <span className={`dag-chevron${open ? ' dag-chevronOpen' : ''}`}>▾</span>
      </button>
      {open ? (
        <div className="dag-body">
          {disabled ? (
            <p className="dag-readOnly" role="status">
              {t('readOnly')}
            </p>
          ) : null}
          {failClosed ? <p className="dag-warn">{t('warnFailClosed')}</p> : null}
          <div className="dag-field">
            <div className="dag-head">
              <label className="dag-label" htmlFor="dag-enabled">
                {t('enabled')}
              </label>
            </div>
            <div className="dag-checkRow">
              <input
                id="dag-enabled"
                type="checkbox"
                checked={draft.enabled}
                disabled={disabled}
                onChange={(event) => edit('enabled', event.target.checked)}
              />
              <label htmlFor="dag-enabled">{t('enabledHint')}</label>
            </div>
          </div>
          <div className="dag-field">
            <div className="dag-head">
              <label className="dag-label" htmlFor="dag-token">
                {t('token')}
              </label>
              <span className={`dag-badge ${tokenConfigured ? 'dag-badgeSet' : 'dag-badgeUnset'}`}>
                {t(tokenConfigured ? 'tokenSet' : 'tokenUnset')}
              </span>
            </div>
            <input
              id="dag-token"
              className="dag-input"
              type="password"
              autoComplete="off"
              value={draft.token}
              disabled={disabled}
              onChange={(event) => edit('token', event.target.value)}
            />
            <p className="dag-hint">{t('tokenHint')}</p>
          </div>
          <div className="dag-field">
            <div className="dag-head">
              <label className="dag-label" htmlFor="dag-allowed">
                {t('allowedIps')}
              </label>
            </div>
            <textarea
              id="dag-allowed"
              className="dag-textarea"
              rows={Math.min(8, Math.max(3, draft.allowedIpsText.split('\n').length))}
              value={draft.allowedIpsText}
              disabled={disabled}
              onChange={(event) => edit('allowedIpsText', event.target.value)}
            />
            <p className="dag-hint">{t('allowedIpsHint')}</p>
          </div>
          <div className="dag-field">
            <div className="dag-head">
              <label className="dag-label" htmlFor="dag-xff">
                {t('trustForwardedFor')}
              </label>
            </div>
            <div className="dag-checkRow">
              <input
                id="dag-xff"
                type="checkbox"
                checked={draft.trustForwardedFor}
                disabled={disabled}
                onChange={(event) => edit('trustForwardedFor', event.target.checked)}
              />
              <label htmlFor="dag-xff">{t('trustForwardedForHint')}</label>
            </div>
          </div>
          <div className="dag-field">
            <div className="dag-head">
              <label className="dag-label" htmlFor="dag-cookie">
                {t('cookieMaxAgeHours')}
              </label>
            </div>
            <input
              id="dag-cookie"
              className={`dag-input${isPositiveInt(draft.cookieMaxAgeHours) ? '' : ' dag-inputInvalid'}`}
              type="text"
              inputMode="numeric"
              value={draft.cookieMaxAgeHours}
              disabled={disabled}
              aria-invalid={!isPositiveInt(draft.cookieMaxAgeHours) || undefined}
              onChange={(event) => edit('cookieMaxAgeHours', event.target.value)}
            />
            <p className={isPositiveInt(draft.cookieMaxAgeHours) ? 'dag-hint' : 'dag-invalid'}>
              {isPositiveInt(draft.cookieMaxAgeHours)
                ? t('cookieMaxAgeHoursHint')
                : t('invalidNumber')}
            </p>
          </div>
          <div className="dag-field">
            <div className="dag-head">
              <label className="dag-label" htmlFor="dag-faillimit">
                {t('loginFailLimit')}
              </label>
            </div>
            <input
              id="dag-faillimit"
              className={`dag-input${isPositiveInt(draft.loginFailLimit) ? '' : ' dag-inputInvalid'}`}
              type="text"
              inputMode="numeric"
              value={draft.loginFailLimit}
              disabled={disabled}
              aria-invalid={!isPositiveInt(draft.loginFailLimit) || undefined}
              onChange={(event) => edit('loginFailLimit', event.target.value)}
            />
            <p className={isPositiveInt(draft.loginFailLimit) ? 'dag-hint' : 'dag-invalid'}>
              {isPositiveInt(draft.loginFailLimit) ? t('loginFailLimitHint') : t('invalidNumber')}
            </p>
          </div>
          <div className="dag-field">
            <div className="dag-head">
              <label className="dag-label" htmlFor="dag-cooldown">
                {t('loginCooldownMs')}
              </label>
            </div>
            <input
              id="dag-cooldown"
              className={`dag-input${isPositiveInt(draft.loginCooldownMs) ? '' : ' dag-inputInvalid'}`}
              type="text"
              inputMode="numeric"
              value={draft.loginCooldownMs}
              disabled={disabled}
              aria-invalid={!isPositiveInt(draft.loginCooldownMs) || undefined}
              onChange={(event) => edit('loginCooldownMs', event.target.value)}
            />
            <p className={isPositiveInt(draft.loginCooldownMs) ? 'dag-hint' : 'dag-invalid'}>
              {isPositiveInt(draft.loginCooldownMs) ? t('loginCooldownMsHint') : t('invalidNumber')}
            </p>
          </div>
          {diag !== null ? (
            <div className={`dag-diag${diag.invalidEntries.length > 0 ? ' dag-diagWarn' : ''}`}>
              <p className="dag-diagTitle">{t('diagTitle')}</p>
              <div className="dag-diagRow">
                <span className="dag-diagKey">{t('diagVerdict')}</span>
                <span className="dag-diagVal">{verdictLabel(t, diag)}</span>
              </div>
              <div className="dag-diagRow">
                <span className="dag-diagKey">{t('diagClientIp')}</span>
                <span className="dag-diagVal">{diag.clientIp ?? '—'}</span>
              </div>
              <div className="dag-diagRow">
                <span className="dag-diagKey">{t('diagReason')}</span>
                <span className="dag-diagVal">
                  {diag.reason !== null ? t(REASON_KEYS[diag.reason] ?? diag.reason) : '—'}
                </span>
              </div>
              {diag.invalidEntries.length > 0 ? (
                <div className="dag-diagRow">
                  <span className="dag-diagKey">!</span>
                  <span className="dag-diagVal">
                    {t('diagInvalid')}
                    {diag.invalidEntries.join('、')}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="dag-footer">
            {status.kind !== 'idle' ? (
              <p
                className={`dag-status${status.kind === 'error' ? ' dag-statusError' : ''}`}
                role="status"
              >
                {status.text}
              </p>
            ) : null}
            <button
              type="button"
              className="dag-btn dag-btnGhost"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(draftFromValue(value))
                setStatus(IDLE_STATUS)
              }}
            >
              {t('discard')}
            </button>
            <button
              type="button"
              className="dag-btn dag-btnPrimary"
              disabled={!dirty || invalid || saving || disabled}
              onClick={onSave}
            >
              {t(saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
