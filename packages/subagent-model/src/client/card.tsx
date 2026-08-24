/**
 * 「子代理模型配置」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 交互对齐官方卡片：折叠/展开、staged draft、未保存标记、保存/放弃。
 * 配置读写走官方 settingsScope 传输（scope.ts）：value 为 schema 解析后的
 * 命名空间值（enabled + entries），行集合 = 目录返回的已注册子代理 provider
 * ∪ 已配置条目，保存时全量写回 entries（未配置的新 provider 行以默认空值
 * 落盘，自文档化）；「模型目录」为唯一保留的自定义端点。
 * @module subagent-model/client/card
 */
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { SETTINGS_NS } from '../ns.ts'
import { type CatalogProvider, fetchCatalog, type ModelCatalog } from './api.ts'
import {
  type ConfigValue,
  type Draft,
  type DraftRow,
  draftFrom,
  EMPTY_ROW,
  toPatch,
} from './draft.ts'
import { CheckRow, SelectField, type SelectOption } from './fields.tsx'
import type { Scope, SettingsApi } from './scope.ts'

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: SettingsApi
}

interface Status {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

const IDLE_STATUS: Status = { kind: 'idle', text: '' }
const EFFORT_INHERIT = 'inherit'
const EFFORT_DEFAULT = 'default'

function unknownOption(value: string, label: string): SelectOption {
  return { value, label: `${value}（${label}）` }
}

function providerOptions(
  catalog: ModelCatalog | null,
  row: DraftRow,
  t: (k: string) => string,
): SelectOption[] {
  const options: SelectOption[] = [{ value: '', label: t('inheritProvider') }]
  for (const provider of catalog?.providers ?? [])
    options.push({ value: provider.id, label: provider.name })
  if (row.provider.length > 0 && !options.some((o) => o.value === row.provider)) {
    options.push(unknownOption(row.provider, t('unknownValue')))
  }
  return options
}

function modelOptions(
  catalog: ModelCatalog | null,
  row: DraftRow,
  t: (k: string) => string,
): SelectOption[] {
  const options: SelectOption[] = [{ value: '', label: t('inheritModel') }]
  const provider = catalog?.providers.find((p) => p.id === row.provider)
  for (const model of provider?.models ?? []) options.push({ value: model.id, label: model.name })
  if (row.model.length > 0 && !options.some((o) => o.value === row.model)) {
    options.push(unknownOption(row.model, t('unknownValue')))
  }
  return options
}

function effortOptions(
  catalog: ModelCatalog | null,
  row: DraftRow,
  t: (k: string) => string,
): SelectOption[] {
  const options: SelectOption[] = [
    { value: EFFORT_INHERIT, label: t('effortInherit') },
    { value: EFFORT_DEFAULT, label: t('effortDefault') },
  ]
  const provider = catalog?.providers.find((p) => p.id === row.provider)
  const model = provider?.models.find((m) => m.id === row.model)
  for (const effort of model?.reasoning?.efforts ?? [])
    options.push({ value: effort.id, label: effort.name })
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
        <CheckRow
          id={`dsm-row-${name}`}
          label={t('rowEnabled')}
          checked={row.enabled}
          disabled={disabled}
          onEdit={(v) => onEdit({ ...row, enabled: v })}
        />
      </div>
      <p className="dsm-rowHint">{t('rowHint')}</p>
      <SelectField
        id={`dsm-provider-${name}`}
        label={t('provider')}
        hint={t('providerHint')}
        value={row.provider}
        options={providerOptions(catalog, row, t)}
        disabled={disabled}
        onEdit={(v) => onEdit({ ...row, provider: v })}
      />
      <SelectField
        id={`dsm-model-${name}`}
        label={t('model')}
        hint={t('modelHint')}
        value={row.model}
        options={modelOptions(catalog, row, t)}
        disabled={disabled || row.provider.length === 0}
        invalid={invalidModel}
        invalidLabel={t('invalidModel')}
        onEdit={(v) => onEdit({ ...row, model: v })}
      />
      <SelectField
        id={`dsm-effort-${name}`}
        label={t('effort')}
        hint={t('effortHint')}
        value={row.reasoningEffort}
        options={effortOptions(catalog, row, t)}
        disabled={disabled}
        onEdit={(v) => onEdit({ ...row, reasoningEffort: v })}
      />
    </div>
  )
}

export function SubagentModelCard(props: CardProps): ReactElement | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(IDLE_STATUS)

  // 播种草稿（行集 = 已配置条目）；catalog 到达后只补缺失的 provider 空行，
  // 不覆盖在途编辑；后续 Host 更新同样不覆盖。
  useEffect(() => {
    if (value === undefined) return
    setDraft((current) => {
      if (current === null) return draftFrom(value, catalog)
      if (catalog === null) return current
      const rows = { ...current.rows }
      let changed = false
      for (const name of catalog.subagentProviders) {
        if (name in rows) continue
        rows[name] = { ...EMPTY_ROW }
        changed = true
      }
      return changed ? { ...current, rows } : current
    })
  }, [value, catalog])

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
    () =>
      value !== undefined &&
      draft !== null &&
      JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFrom(value, catalog))),
    [value, draft, catalog],
  )
  const invalid = useMemo(
    () =>
      draft !== null &&
      Object.values(draft.rows).some((row) => row.model.length > 0 && row.provider.length === 0),
    [draft],
  )

  if (value === undefined || draft === null) {
    return (
      <li className="dsm-card">
        <p className="dsm-empty">{t('loading')}</p>
      </li>
    )
  }
  const edit = <K extends keyof Draft>(key: K, editValue: Draft[K]): void => {
    setDraft({ ...draft, [key]: editValue })
    setStatus(IDLE_STATUS)
  }
  const editRow = (name: string, row: DraftRow): void => {
    setDraft({ ...draft, rows: { ...draft.rows, [name]: row } })
    setStatus(IDLE_STATUS)
  }
  const onSave = (): void => {
    setSaving(true)
    const revision = scope.getSnapshot().revision
    api
      .update({
        ns: SETTINGS_NS,
        patch: toPatch(draft),
        ...(revision !== undefined ? { expectedRevision: revision } : {}),
      })
      .then(async (response) => {
        if (!response.result.ok) {
          throw new Error(response.result.error?.message ?? t('saveFailed'))
        }
        await scope.load()
        const next = scope.getSnapshot().value as ConfigValue | undefined
        if (next !== undefined) setDraft(draftFrom(next, catalog))
        setStatus(IDLE_STATUS)
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          text: `${t('saveFailed')}${error instanceof Error ? error.message : ''}`,
        })
      })
      .finally(() => setSaving(false))
  }
  const onRetryCatalog = (): void => {
    setCatalog(null)
    setCatalogFailed(false)
  }

  const disabled = !snapshot.writable
  const rowNames = Object.keys(draft.rows).sort()
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
          {disabled ? (
            <p className="dsm-empty" role="status">
              {t('readOnly')}
            </p>
          ) : null}
          <CheckRow
            id="dsm-enabled"
            label={t('enabled')}
            checked={draft.enabled}
            disabled={disabled}
            onEdit={(v) => edit('enabled', v)}
          />
          {catalogFailed ? (
            <div className="dsm-banner" role="status">
              <span>{t('catalogError')}</span>
              <button type="button" className="dsm-bannerRetry" onClick={onRetryCatalog}>
                {t('catalogRetry')}
              </button>
            </div>
          ) : null}
          {catalog === null && !catalogFailed ? (
            <p className="dsm-empty" role="status">
              {t('catalogLoading')}
            </p>
          ) : null}
          {rowNames.length === 0 ? (
            <p className="dsm-empty" role="status">
              {t('noRows')}
            </p>
          ) : null}
          {rowNames.map((name) => (
            <RowBlock
              key={name}
              name={name}
              row={draft.rows[name] ?? { ...EMPTY_ROW }}
              catalog={catalog}
              disabled={disabled}
              t={t}
              onEdit={(row) => editRow(name, row)}
            />
          ))}
          <p className="dsm-hint dsm-rowHint">{providerCount > 0 ? t('rowDesc') : ''}</p>
          <div className="dsm-footer">
            {status.kind !== 'idle' ? (
              <p
                className={`dsm-status${status.kind === 'error' ? ' dsm-statusError' : ''}`}
                role="status"
              >
                {status.text}
              </p>
            ) : null}
            <button
              type="button"
              className="dsm-btn dsm-btnGhost"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(draftFrom(value, catalog))
                setStatus(IDLE_STATUS)
              }}
            >
              {t('discard')}
            </button>
            <button
              type="button"
              className="dsm-btn dsm-btnPrimary"
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

export type { CatalogProvider }
