/**
 * 「功能开关」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 期望态（features dict）读写走官方 settings RPC；生效状态/journal/托管预设
 * 经自建端点（api.ts）轮询。
 * @module feature-toggle/client/card
 */
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'

import { fetchState, rebuildPreset, type ToggleState } from './api.ts'
import type { Scope, SettingsApi } from './scope.ts'

/** 目录在客户端的镜像（与服务端 catalog.ts 同源事实，卡片渲染分组用）。 */
const OFFICIAL_FEATURES = ['subagents', 'web-search', 'plan-mode', 'todo', 'goal'] as const
const DSH_PLUS_FEATURES = [
  'dsh-plus-notify-email',
  'dsh-plus-subagent-model',
  'dsh-plus-skill-manual',
  'dsh-plus-reload',
  'dsh-plus-web-files',
  'dsh-plus-ui-mobile-fit',
  'dsh-plus-remote-settings',
] as const
const ALL_FEATURES: readonly string[] = [...OFFICIAL_FEATURES, ...DSH_PLUS_FEATURES]

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: SettingsApi
}

interface ConfigValue {
  enabled: boolean
  features: Record<string, boolean>
}

interface Status {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

const IDLE_STATUS: Status = { kind: 'idle', text: '' }

type EffectView = {
  desired: boolean
  applied: boolean
  effect: 'immediate' | 'new-session'
  needsBrowserRefresh: boolean
}

function statusChipKey(effect: EffectView | undefined, t: (key: string) => string): string {
  if (effect === undefined) return ''
  if (!effect.applied) return t('statusPending')
  if (effect.effect === 'new-session') return t('statusNewSession')
  if (effect.needsBrowserRefresh) return t('statusNeedsRefresh')
  return t('statusApplied')
}

/** 目录生效方式镜像（与服务端 catalog.ts 同源事实；UI 不依赖轮询数据）。 */
const NEW_SESSION_FEATURES: ReadonlySet<string> = new Set([
  'subagents',
  'web-search',
  'plan-mode',
  'todo',
  'goal',
])

export function FeatureToggleCard(props: CardProps): ReactElement | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null)
  const [state, setState] = useState<ToggleState | null>(null)
  const [saving, setSaving] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [status, setStatus] = useState<Status>(IDLE_STATUS)

  const refreshState = useCallback((): void => {
    fetchState()
      .then(setState)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshState()
    const timer = window.setInterval(refreshState, 5000)
    return () => {
      window.clearInterval(timer)
    }
  }, [refreshState])

  useEffect(() => {
    if (value === undefined || draft !== null) return
    setDraft({ ...value.features })
  }, [value, draft])

  const dirty = useMemo(() => {
    if (value === undefined || draft === null) return false
    for (const id of ALL_FEATURES) {
      if ((value.features[id] ?? true) !== (draft[id] ?? true)) return true
    }
    return false
  }, [value, draft])

  if (value === undefined || draft === null) {
    return (
      <li className="dft-card">
        <p className="dft-readOnly">{t('loading')}</p>
      </li>
    )
  }

  const desiredEnabled = (id: string): boolean => draft[id] ?? true
  const toggle = (id: string, checked: boolean): void => {
    setDraft({ ...draft, [id]: checked })
    setStatus(IDLE_STATUS)
  }

  const onSave = (): void => {
    setSaving(true)
    const revision = scope.getSnapshot().revision
    api
      .update({
        ns: 'dsh-plus-feature-toggle',
        patch: { features: draft },
        ...(revision !== undefined ? { expectedRevision: revision } : {}),
      })
      .then(async (response) => {
        if (!response.result.ok) {
          throw new Error(response.result.error?.message ?? t('saveFailed'))
        }
        await scope.load()
        setStatus(IDLE_STATUS)
        refreshState()
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('saveFailed')}${message}` })
      })
      .finally(() => setSaving(false))
  }

  const onRebuild = (): void => {
    setRebuilding(true)
    rebuildPreset()
      .then(() => {
        setStatus({ kind: 'ok', text: t('presetRebuildDone') })
        refreshState()
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('presetRebuildFailed')}${message}` })
      })
      .finally(() => setRebuilding(false))
  }

  const disabled = !snapshot.writable
  const effects = state?.effects ?? {}
  const preset = state?.preset
  const pendingRestart = state?.pendingRestart === true
  const quarantined = state?.quarantined ?? []
  const needsRefreshBanner = Object.values(effects).some(
    (effect) => effect.applied && effect.needsBrowserRefresh,
  )

  const renderRow = (id: string): ReactElement => {
    const effect = effects[id]
    const chip = statusChipKey(effect, t)
    return (
      <div key={id} className="dft-row">
        <div className="dft-rowText">
          <span className="dft-rowTitle">{t(`feature.${id}`)}</span>
          <span className="dft-rowDesc">{t(`feature.${id}.desc`)}</span>
          <span className="dft-rowEffect">
            {t(NEW_SESSION_FEATURES.has(id) ? 'effectNewSession' : 'effectImmediate')}
          </span>
        </div>
        {chip.length > 0 ? (
          <span className={`dft-chip${effect?.applied === false ? ' dft-chipPending' : ''}`}>
            {chip}
          </span>
        ) : null}
        <input
          id={`dft-${id}`}
          className="dft-check"
          type="checkbox"
          checked={desiredEnabled(id)}
          disabled={disabled}
          onChange={(event) => toggle(id, event.target.checked)}
        />
      </div>
    )
  }

  return (
    <li className={`dft-card${open ? ' dft-cardOpen' : ''}`}>
      <button
        type="button"
        className="dft-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => setOpen(!open)}
      >
        <span className="dft-headText">
          <span className="dft-name">{t('title')}</span>
          <span className="dft-description">{t('description')}</span>
        </span>
        {dirty ? <span className="dft-pending">{t('unsaved')}</span> : null}
        <span className={`dft-chevron${open ? ' dft-chevronOpen' : ''}`}>▾</span>
      </button>
      {open ? (
        <div className="dft-body">
          {disabled ? (
            <p className="dft-readOnly" role="status">
              {t('readOnly')}
            </p>
          ) : null}

          {pendingRestart ? (
            <p className="dft-banner dft-bannerError" role="alert">
              {t('bannerPendingRestart')}
            </p>
          ) : (
            <p className="dft-banner">{t('bannerNoRestart')}</p>
          )}
          {needsRefreshBanner ? <p className="dft-banner">{t('bannerRefresh')}</p> : null}
          {quarantined.length > 0 ? (
            <p className="dft-banner dft-bannerWarn" role="alert">
              {t('bannerQuarantined')} {quarantined.join(', ')}
            </p>
          ) : null}
          {(state?.drift ?? []).length > 0 ? (
            <div className="dft-banner dft-bannerWarn" role="alert">
              <p className="dft-driftTitle">{t('bannerDrift')}</p>
              <ul className="dft-driftList">
                {(state?.drift ?? []).map((finding) => (
                  <li key={`${finding.kind}-${finding.subject}`}>{finding.detail}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {preset !== undefined && !preset.exists ? (
            <p className="dft-banner dft-bannerWarn">{t('presetMissing')}</p>
          ) : null}
          {preset?.exists && !preset.isDefault ? (
            <p className="dft-banner dft-bannerWarn">{t('presetNotDefault')}</p>
          ) : null}

          <p className="dft-groupLabel">{t('groupOfficial')}</p>
          {OFFICIAL_FEATURES.map(renderRow)}
          <p className="dft-groupLabel">{t('groupDshPlus')}</p>
          {DSH_PLUS_FEATURES.map(renderRow)}

          <div className="dft-presetBox">
            <p className="dft-groupLabel">{t('presetTitle')}</p>
            {preset !== undefined ? (
              <p className="dft-hint">
                {t('presetSource')}: {preset.sourcePresetId} · default → {preset.defaultId ?? '—'}
              </p>
            ) : null}
            <button
              type="button"
              className="dft-btn dft-btnGhost"
              disabled={rebuilding}
              onClick={onRebuild}
            >
              {rebuilding ? t('presetRebuilding') : t('presetRebuild')}
            </button>
          </div>

          <div className="dft-journalBox">
            <p className="dft-groupLabel">{t('journalTitle')}</p>
            {(state?.journal ?? []).length === 0 ? (
              <p className="dft-hint">{t('journalEmpty')}</p>
            ) : (
              <ul className="dft-journal">
                {[...(state?.journal ?? [])].reverse().map((entry) => (
                  <li
                    key={`${entry.at}-${entry.kind}-${entry.detail}`}
                    className="dft-journalEntry"
                  >
                    <span className="dft-journalKind">{entry.kind}</span>
                    <span className="dft-journalDetail">{entry.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="dft-footer">
            <p className={`dft-status${status.kind === 'error' ? ' dft-statusError' : ''}`}>
              {status.text}
            </p>
            {dirty ? (
              <>
                <button
                  type="button"
                  className="dft-btn dft-btnGhost"
                  disabled={disabled || saving}
                  onClick={() => {
                    setDraft({ ...value.features })
                    setStatus(IDLE_STATUS)
                  }}
                >
                  {t('discard')}
                </button>
                <button
                  type="button"
                  className="dft-btn dft-btnPrimary"
                  disabled={disabled || saving}
                  onClick={onSave}
                >
                  {saving ? t('saving') : t('save')}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  )
}
