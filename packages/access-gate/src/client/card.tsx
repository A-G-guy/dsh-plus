/**
 * 「访问控制」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 外壳与基础控件走 @dsh-plus/shared/client 套件（CardChrome/TextField/CheckRow），
 * 本文件保留业务字段（token/白名单 textarea/诊断面板）与保存逻辑。
 * 配置读写走官方 settingsScope 传输：value 为 schema 解析后的脱敏视图
 * （token 不出现，tokenConfigured 经 describe 的 secrets 探测），
 * 保存经 settings.update 深合并（空 token 剔除 = 保持不变）。
 * 卡片顶部「当前页面诊断」读 /dsh-plus/gate/status（本页放行原因/客户端 IP）。
 * @module access-gate/client/card
 */

import {
  CardChrome,
  type CardStatusState,
  CheckRow,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type Scope,
  TextField,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { SETTINGS_NS } from '../ns.ts'

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: NamespaceSettingsApi
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

interface Diag {
  enabled: boolean
  verdict: string
  clientIp: string | null
  reason: string | null
  invalidEntries: string[]
  tokenConfigured: boolean
  allowedCount: number
}

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
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)

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
      .describe()
      .then((view) => {
        if (!alive) return
        const ns = view.namespaces.find((candidate) => candidate.ns === SETTINGS_NS)
        setTokenConfigured(
          ns?.secrets.some((secret) => secret.path.join('.') === 'token' && secret.set) ?? false,
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
      .update(patch, revision)
      .then(async () => {
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
    <CardChrome
      prefix="dag"
      title={t('title')}
      description={t('description')}
      open={open}
      onToggle={setOpen}
      statusBadge={{ text: t(draft.enabled ? 'enabledOn' : 'enabledOff'), on: draft.enabled }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={[
        {
          key: 'discard',
          label: t('discard'),
          disabled: !dirty || saving,
          onClick: () => {
            setDraft(draftFromValue(value))
            setStatus(IDLE_STATUS)
          },
        },
        {
          key: 'save',
          label: t(saving ? 'saving' : 'save'),
          variant: 'primary',
          disabled: !dirty || invalid || saving || disabled,
          onClick: onSave,
        },
      ]}
    >
      {failClosed ? <p className="dag-warn">{t('warnFailClosed')}</p> : null}
      <CheckRow
        prefix="dag"
        id="dag-enabled"
        label={t('enabledHint')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(v) => edit('enabled', v)}
      />
      <TextField
        prefix="dag"
        id="dag-token"
        label={t('token')}
        hint={t('tokenHint')}
        value={draft.token}
        password
        disabled={disabled}
        badge={{ text: t(tokenConfigured ? 'tokenSet' : 'tokenUnset'), set: tokenConfigured }}
        onEdit={(v) => edit('token', v)}
      />
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
      <CheckRow
        prefix="dag"
        id="dag-xff"
        label={t('trustForwardedForHint')}
        checked={draft.trustForwardedFor}
        disabled={disabled}
        onEdit={(v) => edit('trustForwardedFor', v)}
      />
      <TextField
        prefix="dag"
        id="dag-cookie"
        label={t('cookieMaxAgeHours')}
        hint={t('cookieMaxAgeHoursHint')}
        value={draft.cookieMaxAgeHours}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.cookieMaxAgeHours)}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => edit('cookieMaxAgeHours', v)}
      />
      <TextField
        prefix="dag"
        id="dag-faillimit"
        label={t('loginFailLimit')}
        hint={t('loginFailLimitHint')}
        value={draft.loginFailLimit}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.loginFailLimit)}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => edit('loginFailLimit', v)}
      />
      <TextField
        prefix="dag"
        id="dag-cooldown"
        label={t('loginCooldownMs')}
        hint={t('loginCooldownMsHint')}
        value={draft.loginCooldownMs}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.loginCooldownMs)}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => edit('loginCooldownMs', v)}
      />
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
    </CardChrome>
  )
}
