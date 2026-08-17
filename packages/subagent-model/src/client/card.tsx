/**
 * 「子代理模型配置」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 交互对齐官方卡片：折叠/展开、staged draft、未保存标记、保存/放弃；
 * 数据走自建同源路由（api.ts）。行集合 = 已注册子代理 provider ∪ 已配置条目，
 * 保存时全量写回 entries（未配置的新 provider 行以默认空值落盘，自文档化）。
 * @module subagent-model/client/card
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'

import {
  fetchCatalog, fetchConfig, saveConfig,
  type CatalogProvider, type ModelCatalog, type WireConfig, type WireEntry, type WirePatch,
} from './api.ts'
import { CheckRow, SelectField, type SelectOption } from './fields.tsx'

export interface CardProps {
  t(key: string): string
}

interface DraftRow {
  enabled: boolean
  provider: string
  model: string
  reasoningEffort: string
}

interface Draft {
  enabled: boolean
  rows: Record<string, DraftRow>
}

interface Status {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

const IDLE_STATUS: Status = { kind: 'idle', text: '' }
const EMPTY_ROW: DraftRow = { enabled: false, provider: '', model: '', reasoningEffort: 'inherit' }
const EFFORT_INHERIT = 'inherit'
const EFFORT_DEFAULT = 'default'

function draftFromWire(wire: WireConfig): Draft {
  const rows: Record<string, DraftRow> = {}
  const names = [...wire.subagentProviders, ...Object.keys(wire.entries).sort()]
  for (const name of names) {
    const entry = wire.entries[name]
    rows[name] = entry === undefined
      ? { ...EMPTY_ROW }
      : {
          enabled: entry.enabled,
          provider: entry.provider,
          model: entry.model,
          reasoningEffort: entry.reasoningEffort,
        }
  }
  return { enabled: wire.enabled, rows }
}

function toPatch(draft: Draft): WirePatch {
  return { enabled: draft.enabled, entries: draft.rows }
}

function rowNamesOf(wire: WireConfig, draft: Draft): string[] {
  const names = new Set<string>()
  for (const name of wire.subagentProviders) names.add(name)
  for (const name of Object.keys(draft.rows).sort()) names.add(name)
  return [...names]
}

function unknownOption(value: string, label: string): SelectOption {
  return { value, label: `${value}（${label}）` }
}

function providerOptions(catalog: ModelCatalog | null, row: DraftRow, t: (k: string) => string): SelectOption[] {
  const options: SelectOption[] = [{ value: '', label: t('inheritProvider') }]
  for (const provider of catalog?.providers ?? []) options.push({ value: provider.id, label: provider.name })
  if (row.provider.length > 0 && !options.some((o) => o.value === row.provider)) {
    options.push(unknownOption(row.provider, t('unknownValue')))
  }
  return options
}

function modelOptions(catalog: ModelCatalog | null, row: DraftRow, t: (k: string) => string): SelectOption[] {
  const options: SelectOption[] = [{ value: '', label: t('inheritModel') }]
  const provider = catalog?.providers.find((p) => p.id === row.provider)
  for (const model of provider?.models ?? []) options.push({ value: model.id, label: model.name })
  if (row.model.length > 0 && !options.some((o) => o.value === row.model)) {
    options.push(unknownOption(row.model, t('unknownValue')))
  }
  return options
}

function effortOptions(catalog: ModelCatalog | null, row: DraftRow, t: (k: string) => string): SelectOption[] {
  const options: SelectOption[] = [
    { value: EFFORT_INHERIT, label: t('effortInherit') },
    { value: EFFORT_DEFAULT, label: t('effortDefault') },
  ]
  const provider = catalog?.providers.find((p) => p.id === row.provider)
  const model = provider?.models.find((m) => m.id === row.model)
  for (const effort of model?.reasoning?.efforts ?? []) options.push({ value: effort.id, label: effort.name })
  if (row.reasoningEffort.length > 0 && !options.some((o) => o.value === row.reasoningEffort)) {
    options.push(unknownOption(row.reasoningEffort, t('unknownValue')))
  }
  return options
}

interface RowBlockProps {
  name: string
  row: DraftRow
  catalog: ModelCatalog | null
  disabled: boolean
  t(key: string): string
  onEdit(row: DraftRow): void
}

function RowBlock(props: RowBlockProps): ReactElement {
  const { name, row, catalog, disabled, t, onEdit } = props
  const invalidModel = row.model.length > 0 && row.provider.length === 0
  return (
    <div className="dsm-row">
      <div className="dsm-rowHead">
        <span className="dsm-rowName">{name}</span>
        <CheckRow id={`dsm-row-${name}`} label={t('rowEnabled')} checked={row.enabled}
          disabled={disabled} onEdit={(v) => onEdit({ ...row, enabled: v })} />
      </div>
      <p className="dsm-rowHint">{t('rowHint')}</p>
      <SelectField id={`dsm-provider-${name}`} label={t('provider')} hint={t('providerHint')}
        value={row.provider} options={providerOptions(catalog, row, t)} disabled={disabled}
        onEdit={(v) => onEdit({ ...row, provider: v })} />
      <SelectField id={`dsm-model-${name}`} label={t('model')} hint={t('modelHint')}
        value={row.model} options={modelOptions(catalog, row, t)} disabled={disabled || row.provider.length === 0}
        invalid={invalidModel} invalidLabel={t('invalidModel')}
        onEdit={(v) => onEdit({ ...row, model: v })} />
      <SelectField id={`dsm-effort-${name}`} label={t('effort')} hint={t('effortHint')}
        value={row.reasoningEffort} options={effortOptions(catalog, row, t)} disabled={disabled}
        onEdit={(v) => onEdit({ ...row, reasoningEffort: v })} />
    </div>
  )
}

export function SubagentModelCard(props: CardProps): ReactElement | null {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [wire, setWire] = useState<WireConfig | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
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
        if (alive) setLoadFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!open || catalog !== null) return
    let alive = true
    fetchCatalog()
      .then((loaded) => {
        if (!alive) return
        setCatalog(loaded)
        setCatalogFailed(false)
      })
      .catch(() => {
        if (alive) setCatalogFailed(true)
      })
    return () => {
      alive = false
    }
  }, [open, catalog])

  const dirty = useMemo(
    () => wire !== null && draft !== null &&
      JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFromWire(wire))),
    [wire, draft],
  )
  const invalid = useMemo(
    () => draft !== null && Object.values(draft.rows).some((row) =>
      row.model.length > 0 && row.provider.length === 0),
    [draft],
  )

  if (loadFailed) return null
  if (wire === null || draft === null) {
    return <li className="dsm-card"><p className="dsm-empty">{t('loading')}</p></li>
  }
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft({ ...draft, [key]: value })
    setStatus(IDLE_STATUS)
  }
  const editRow = (name: string, row: DraftRow): void => {
    setDraft({ ...draft, rows: { ...draft.rows, [name]: row } })
    setStatus(IDLE_STATUS)
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
        setStatus({ kind: 'error', text: `${t('saveFailed')}${error instanceof Error ? error.message : ''}` })
      })
      .finally(() => setSaving(false))
  }
  const onRetryCatalog = (): void => {
    setCatalog(null)
    setCatalogFailed(false)
  }

  const disabled = !wire.writable
  const rowNames = rowNamesOf(wire, draft)
  const providerCount = (catalog?.providers ?? []).length
  return (
    <li className={`dsm-card${open ? ' dsm-cardOpen' : ''}`}>
      <button
        type="button"
        className="dsm-header"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => setOpen(!open)}
      >
        <span className="dsm-headText">
          <span className="dsm-name">{t('title')}</span>
          <span className="dsm-description">{t('description')}</span>
        </span>
        {dirty ? <span className="dsm-pending">{t('unsaved')}</span> : null}
        <span className={`dsm-chevron${open ? ' dsm-chevronOpen' : ''}`}>▾</span>
      </button>
      {open ? (
        <div className="dsm-body">
          {disabled ? <p className="dsm-empty" role="status">{t('readOnly')}</p> : null}
          <CheckRow id="dsm-enabled" label={t('enabled')} checked={draft.enabled} disabled={disabled}
            onEdit={(v) => edit('enabled', v)} />
          {catalogFailed ? (
            <div className="dsm-banner" role="status">
              <span>{t('catalogError')}</span>
              <button type="button" className="dsm-bannerRetry" onClick={onRetryCatalog}>
                {t('catalogRetry')}
              </button>
            </div>
          ) : null}
          {catalog === null && !catalogFailed ? (
            <p className="dsm-empty" role="status">{t('catalogLoading')}</p>
          ) : null}
          {rowNames.length === 0 ? (
            <p className="dsm-empty" role="status">{t('noRows')}</p>
          ) : null}
          {rowNames.map((name) => (
            <RowBlock key={name} name={name} row={draft.rows[name] ?? { ...EMPTY_ROW }}
              catalog={catalog} disabled={disabled} t={t}
              onEdit={(row) => editRow(name, row)} />
          ))}
          <p className="dsm-hint dsm-rowHint">
            {providerCount > 0 ? t('rowDesc') : ''}
          </p>
          <div className="dsm-footer">
            {status.kind !== 'idle' ? (
              <p className={`dsm-status${status.kind === 'error' ? ' dsm-statusError' : ''}`} role="status">
                {status.text}
              </p>
            ) : null}
            <button type="button" className="dsm-btn dsm-btnGhost" disabled={!dirty || saving}
              onClick={() => { setDraft(draftFromWire(wire)); setStatus(IDLE_STATUS) }}>
              {t('discard')}
            </button>
            <button type="button" className="dsm-btn dsm-btnPrimary" disabled={!dirty || invalid || saving || disabled}
              onClick={onSave}>
              {t(saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export type { CatalogProvider }
