/**
 * 「LLM 路由」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 顶部：enabled / catalogUrl / catalogRefreshHours / 只读状态行（kitSource、
 * modelsDevStatus）+ 保存（PUT 全量）与错误/成功提示；下方为 providers 路由
 * 列表（新增/删除/字段编辑/compat/模型目录，见 views/）。
 * 交互对齐官方卡片与 notify-email：折叠/展开、staged draft、未保存标记。
 * @module llm-pi/client/card
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'

import { fetchConfig, refreshCatalog, saveConfig, type WireConfig, type WireModelsDevStatus } from './api.ts'
import { draftFromWire, emptyProviderDraft, numTextOk, toPatch, type Draft, type ProviderDraft } from './draft.ts'
import { CheckRow, TextField } from './fields.tsx'
import { ProvidersSection } from './views/providers.tsx'

export interface CardProps {
  t(key: string): string
}

interface Status {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

const IDLE_STATUS: Status = { kind: 'idle', text: '' }

function modelsDevText(status: WireModelsDevStatus | null, t: (key: string) => string): string {
  if (status === null) return t('modelsDevEmpty')
  if (status.error !== null) return `${t('modelsDevError')}${status.error}`
  if (status.fetchedAt === null) return t('modelsDevEmpty')
  return `${t('modelsDevStatusLine')}：${status.providers} 个 provider，快照 ${status.fetchedAt}`
}

export function LlmPiCard(props: CardProps): ReactElement | null {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [wire, setWire] = useState<WireConfig | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
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
    () =>
      wire !== null &&
      draft !== null &&
      JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFromWire(wire))),
    [wire, draft],
  )
  const invalid = useMemo(() => {
    if (draft === null) return false
    return (
      !numTextOk(draft.catalogRefreshHours) ||
      Object.values(draft.providers).some((provider) =>
        provider.models.some((model) => model.id.trim() === ''),
      )
    )
  }, [draft])

  if (failed) return null
  if (wire === null || draft === null) {
    return <li className="lpc-card"><p className="lpc-readOnly">{t('loading')}</p></li>
  }

  const setProvider = (route: string, patch: Partial<ProviderDraft>): void => {
    const current = draft.providers[route] ?? emptyProviderDraft()
    setDraft({ ...draft, providers: { ...draft.providers, [route]: { ...current, ...patch } } })
    setStatus(IDLE_STATUS)
  }
  const onAddRoute = (key: string): void => {
    setDraft({ ...draft, providers: { ...draft.providers, [key]: emptyProviderDraft() } })
    setStatus(IDLE_STATUS)
  }
  const onRemoveRoute = (route: string): void => {
    const next = { ...draft.providers }
    delete next[route]
    setDraft({ ...draft, providers: next })
    setStatus(IDLE_STATUS)
  }
  const onSave = (): void => {
    setSaving(true)
    saveConfig(toPatch(draft))
      .then((saved) => {
        setWire(saved)
        setDraft(draftFromWire(saved))
        setEpoch((value) => value + 1)
        setStatus({ kind: 'ok', text: t('saveOk') })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('saveFailed')}${message}` })
      })
      .finally(() => setSaving(false))
  }
  const onDiscard = (): void => {
    setDraft(draftFromWire(wire))
    setEpoch((value) => value + 1)
    setStatus(IDLE_STATUS)
  }
  const onRefreshCatalog = (): void => {
    setRefreshing(true)
    refreshCatalog()
      .then((result) => {
        setWire({ ...wire, modelsDevStatus: result.status })
        setStatus({ kind: 'ok', text: t('refreshOk') })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('refreshFailed')}${message}` })
      })
      .finally(() => setRefreshing(false))
  }

  const disabled = !wire.writable
  return (
    <li className={`lpc-card${open ? ' lpc-cardOpen' : ''}`}>
      <button
        type="button"
        className="lpc-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => setOpen(!open)}
      >
        <span className="lpc-headText">
          <span className="lpc-name">{t('title')}</span>
          <span className="lpc-description">{t('description')}</span>
        </span>
        {dirty ? <span className="lpc-pending">{t('unsaved')}</span> : null}
        <span className={`lpc-chevron${open ? ' lpc-chevronOpen' : ''}`}>▾</span>
      </button>
      {open ? (
        <div className="lpc-body">
          {disabled ? <p className="lpc-readOnly" role="status">{t('readOnly')}</p> : null}
          <CheckRow
            id="lpc-enabled"
            label={t('enabled')}
            checked={draft.enabled}
            disabled={disabled}
            onEdit={(value) => {
              setDraft({ ...draft, enabled: value })
              setStatus(IDLE_STATUS)
            }}
          />
          <TextField
            id="lpc-catalogUrl"
            label={t('catalogUrl')}
            hint={t('catalogUrlHint')}
            value={draft.catalogUrl}
            disabled={disabled}
            onEdit={(value) => {
              setDraft({ ...draft, catalogUrl: value })
              setStatus(IDLE_STATUS)
            }}
          />
          <TextField
            id="lpc-catalogRefresh"
            label={t('catalogRefreshHours')}
            hint={t('catalogRefreshHoursHint')}
            value={draft.catalogRefreshHours}
            numeric
            disabled={disabled}
            invalid={!numTextOk(draft.catalogRefreshHours)}
            invalidLabel={t('invalidNumber')}
            onEdit={(value) => {
              setDraft({ ...draft, catalogRefreshHours: value })
              setStatus(IDLE_STATUS)
            }}
          />
          <TextField
            id="lpc-catalogProxy"
            label={t('catalogProxy')}
            hint={t('catalogProxyHint')}
            value={draft.catalogProxy}
            disabled={disabled}
            onEdit={(value) => {
              setDraft({ ...draft, catalogProxy: value })
              setStatus(IDLE_STATUS)
            }}
          />
          <p className="lpc-statusRow">{t('kitSource')}：{wire.kitSource}</p>
          <div className="lpc-statusRow">
            <span>{t('modelsDevStatus')}：{modelsDevText(wire.modelsDevStatus, t)}</span>
            <button
              type="button"
              className="lpc-btn lpc-btnGhost lpc-btnSmall lpc-refreshBtn"
              disabled={disabled || refreshing}
              onClick={onRefreshCatalog}
            >
              {t(refreshing ? 'refreshingCatalog' : 'refreshCatalog')}
            </button>
          </div>
          <ProvidersSection
            providers={draft.providers}
            epoch={epoch}
            disabled={disabled}
            t={t}
            onAddRoute={onAddRoute}
            onRemoveRoute={onRemoveRoute}
            onPatchProvider={setProvider}
          />
          <div className="lpc-footer">
            {status.kind !== 'idle' ? (
              <p className={`lpc-status${status.kind === 'error' ? ' lpc-statusError' : ''}`} role="status">
                {status.text}
              </p>
            ) : null}
            <button type="button" className="lpc-btn lpc-btnGhost" disabled={!dirty || saving}
              onClick={onDiscard}>
              {t('discard')}
            </button>
            <button type="button" className="lpc-btn lpc-btnPrimary"
              disabled={!dirty || invalid || saving || disabled}
              onClick={onSave}>
              {t(saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
