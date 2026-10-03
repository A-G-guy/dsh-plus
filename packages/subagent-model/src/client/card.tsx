/**
 * 「子代理模型配置」配置卡片：经 injectPluginConfigCard 注册（插件页 plugins.row.config /
 * plugins.bundle.config，view 分发 summary/page）。
 * 外壳与基础控件走 @dsh-plus/shared/client 套件（CardChrome/CheckRow/SelectField）。
 * 配置读写经共享层 ctx.remote.settings 直连（0.1.7 起 settingsScope 已由 configForms
 * 取代）：value 为 schema 解析后的命名空间值
 * （enabled + entries），行集合 = 目录返回的已注册子代理 provider
 * ∪ 已配置条目，保存时全量写回 entries（未配置的新 provider 行以默认空值
 * 落盘，自文档化）；「模型目录」为唯一保留的自定义端点。
 * @module subagent-model/client/card
 */

import {
  type CardAction,
  CardChrome,
  CardLoading,
  type CardStatusState,
  CheckRow,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
  SelectField,
  type SelectOption,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type CatalogProvider, fetchCatalog, type ModelCatalog } from './api.ts'
import {
  type ConfigValue,
  type Draft,
  type DraftRow,
  draftFrom,
  EMPTY_ROW,
  toPatch,
} from './draft.ts'
import type { Translate } from './i18n.ts'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

const EFFORT_INHERIT = 'inherit'
const EFFORT_DEFAULT = 'default'

function unknownOption(value: string, label: string): SelectOption {
  return { value, label: `${value}（${label}）` }
}

function providerOptions(
  catalog: ModelCatalog | null,
  row: DraftRow,
  t: Translate,
): SelectOption[] {
  const options: SelectOption[] = [{ value: '', label: t('inheritProvider') }]
  for (const provider of catalog?.providers ?? [])
    options.push({ value: provider.id, label: provider.name })
  if (row.provider.length > 0 && !options.some((o) => o.value === row.provider)) {
    options.push(unknownOption(row.provider, t('unknownValue')))
  }
  return options
}

function modelOptions(catalog: ModelCatalog | null, row: DraftRow, t: Translate): SelectOption[] {
  const options: SelectOption[] = [{ value: '', label: t('inheritModel') }]
  const provider = catalog?.providers.find((p) => p.id === row.provider)
  for (const model of provider?.models ?? []) options.push({ value: model.id, label: model.name })
  if (row.model.length > 0 && !options.some((o) => o.value === row.model)) {
    options.push(unknownOption(row.model, t('unknownValue')))
  }
  return options
}

function effortOptions(catalog: ModelCatalog | null, row: DraftRow, t: Translate): SelectOption[] {
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
  t: Translate
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
          prefix="dsm"
          id={`dsm-row-${name}`}
          label={t('rowEnabled')}
          checked={row.enabled}
          disabled={disabled}
          onEdit={(v) => onEdit({ ...row, enabled: v })}
        />
      </div>
      <p className="dsm-rowHint">{t('rowHint')}</p>
      <SelectField
        prefix="dsm"
        id={`dsm-provider-${name}`}
        label={t('provider')}
        hint={t('providerHint')}
        value={row.provider}
        options={providerOptions(catalog, row, t)}
        disabled={disabled}
        onEdit={(v) => onEdit({ ...row, provider: v })}
      />
      <SelectField
        prefix="dsm"
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
        prefix="dsm"
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

/** 目录状态行：拉取失败给重试入口，拉取中与空行集各给一行提示。 */
function CatalogStatus(props: {
  t: Translate
  catalog: ModelCatalog | null
  catalogFailed: boolean
  rowCount: number
  onRetry(): void
}): ReactElement | null {
  if (props.catalogFailed) {
    return (
      <div className="dsm-banner" role="status">
        <span>{props.t('catalogError')}</span>
        <button type="button" className="dsm-bannerRetry" onClick={props.onRetry}>
          {props.t('catalogRetry')}
        </button>
      </div>
    )
  }
  if (props.catalog === null) {
    return (
      <p className="dsm-empty" role="status">
        {props.t('catalogLoading')}
      </p>
    )
  }
  if (props.rowCount === 0) {
    return (
      <p className="dsm-empty" role="status">
        {props.t('noRows')}
      </p>
    )
  }
  return null
}

/**
 * 子代理 provider 目录（挂载后拉取一次；失败保留重试入口，重试即回到未加载态）。
 * 与草稿播种共用同一个 catalog：目录到达后由调用方补缺失的空行。
 */
function useCatalog(): {
  catalog: ModelCatalog | null
  catalogFailed: boolean
  retry(): void
} {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  useEffect(() => {
    if (catalog !== null) return
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
  }, [catalog])
  return {
    catalog,
    catalogFailed,
    retry: () => {
      setCatalog(null)
      setCatalogFailed(false)
    },
  }
}

/** 卡片动作：放弃（回到 Host 值）与保存（无效行或只读时禁用）。 */ function cardActions(options: {
  t: Translate
  dirty: boolean
  invalid: boolean
  saving: boolean
  disabled: boolean
  onDiscard(): void
  onSave(): void
}): CardAction[] {
  const { t } = options
  return [
    {
      key: 'discard',
      label: t('discard'),
      disabled: !options.dirty || options.saving,
      onClick: options.onDiscard,
    },
    {
      key: 'save',
      label: t(options.saving ? 'saving' : 'save'),
      variant: 'primary',
      disabled: !options.dirty || options.invalid || options.saving || options.disabled,
      onClick: options.onSave,
    },
  ]
}

export function SubagentModelCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)
  const { catalog, catalogFailed, retry: retryCatalog } = useCatalog()

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

  // 插件页 summary 视图只出一行简介（hooks 已全部落定，可安全提前返回）。
  if (props.view === 'summary') return t('summaryLine')

  if (value === undefined || draft === null) {
    return <CardLoading prefix="dsm" text={t('loading')} />
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
      .update(toPatch(draft), revision)
      .then(async () => {
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

  const disabled = !snapshot.writable
  const rowNames = Object.keys(draft.rows).sort()
  const providerCount = (catalog?.providers ?? []).length
  return (
    <CardChrome
      prefix="dsm"
      title={t('title')}
      description={t('description')}
      statusBadge={{ text: t(draft.enabled ? 'enabledOn' : 'enabledOff'), on: draft.enabled }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={cardActions({
        t,
        dirty,
        invalid,
        saving,
        disabled,
        onDiscard: () => {
          setDraft(draftFrom(value, catalog))
          setStatus(IDLE_STATUS)
        },
        onSave,
      })}
    >
      <CheckRow
        prefix="dsm"
        id="dsm-enabled"
        label={t('enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(v) => edit('enabled', v)}
      />
      <CatalogStatus
        t={t}
        catalog={catalog}
        catalogFailed={catalogFailed}
        rowCount={rowNames.length}
        onRetry={retryCatalog}
      />
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
    </CardChrome>
  )
}

export type { CatalogProvider }
