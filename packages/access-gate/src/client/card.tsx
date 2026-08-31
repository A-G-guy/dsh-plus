/**
 * 「访问控制」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 外壳与基础控件走 @dsh-plus/shared/client 套件（CardChrome/TextField/CheckRow），
 * 本文件保留业务字段（白名单 textarea/诊断面板）与保存逻辑。
 * 配置读写走官方 settingsScope 传输：value 为 schema 解析后的视图，
 * 保存经 settings.update 深合并。
 * 卡片顶部「当前页面诊断」读 /dsh-plus/gate/status（本页放行原因/客户端 IP/
 * 官方 cookie 状态）。
 *
 * 与官方认证合并后：访问凭据由官方 browser-auth 持有（30 天 cookie），
 * 卡片不再管理令牌；allowedIps 仅为可选附加 IP 围栏。
 * @module access-gate/client/card
 */

import {
  CardChrome,
  type CardStatusState,
  CheckRow,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type Scope,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: NamespaceSettingsApi
}

/** settings 命名空间的解析值。 */
export interface ConfigValue {
  enabled: boolean
  allowedIps: string[]
  trustForwardedFor: boolean
}

interface Draft {
  enabled: boolean
  allowedIpsText: string
  trustForwardedFor: boolean
}

interface Diag {
  enabled: boolean
  verdict: string
  clientIp: string | null
  reason: string | null
  officialAuthed: boolean
  ipFenceActive: boolean
  invalidEntries: string[]
  allowedCount: number
}

function draftFromValue(value: ConfigValue): Draft {
  return {
    enabled: value.enabled,
    allowedIpsText: value.allowedIps.join('\n'),
    trustForwardedFor: value.trustForwardedFor,
  }
}

function toPatch(draft: Draft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    allowedIps: draft.allowedIpsText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    trustForwardedFor: draft.trustForwardedFor,
  }
}

/** reason 枚举 → 文案 key。 */
const REASON_KEYS: Record<string, string> = {
  local: 'diagLocal',
  cookie: 'diagCookie',
}

function verdictLabel(t: (key: string) => string, diag: Diag): string {
  if (!diag.enabled) return t('diagOff')
  if (diag.verdict === 'pass') return t('diagPass')
  if (diag.verdict === 'token-page') return t('diagTokenPage')
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
  const [diag, setDiag] = useState<Diag | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)

  // 首次拿到解析值后播种草稿；后续 Host 更新不覆盖在途编辑（与官方 staged 表单一致）。
  useEffect(() => {
    if (value === undefined || draft !== null) return
    setDraft(draftFromValue(value))
  }, [value, draft])

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

  const dirty = useMemo(
    () =>
      value !== undefined &&
      draft !== null &&
      JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFromValue(value))),
    [value, draft],
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
          disabled: !dirty || saving || disabled,
          onClick: onSave,
        },
      ]}
    >
      <p className="dag-hint">{t('mergedHint')}</p>
      <CheckRow
        prefix="dag"
        id="dag-enabled"
        label={t('enabledHint')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(v) => edit('enabled', v)}
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
          <div className="dag-diagRow">
            <span className="dag-diagKey">{t('diagOfficial')}</span>
            <span className="dag-diagVal">
              {diag.officialAuthed ? t('diagOfficialYes') : t('diagOfficialNo')}
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
