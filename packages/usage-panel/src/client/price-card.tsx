/**
 * 价目配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 价目行编辑（provider/model/四价）+ models.dev 一键导入 + 代理配置。
 * @module usage-panel/client/price-card
 */

import {
  CardChrome,
  type CardStatusState,
  IDLE_STATUS,
  type Scope,
  type SettingsApi,
  TextField,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { fetchModelsDevRaw, importPricesFromModelsDev } from './api.ts'

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: SettingsApi
}

interface ConfigValue {
  prices: Array<{
    provider: string
    model: string
    inputPerMtok: number
    outputPerMtok: number
    cacheReadPerMtok: number
    cacheWritePerMtok: number
  }>
  currency: string
  catalogProxy: string
}

const MODELS_DEV_URL = 'https://models.dev/api.json'

function num(text: string): number {
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function numTextOk(text: string): boolean {
  return /^\d+(\.\d+)?$/.test(text.trim())
}

export function UsagePriceCard(props: CardProps): ReactElement | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ConfigValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)

  useEffect(() => {
    if (value !== undefined && draft === null) setDraft(structuredClone(value))
  }, [value, draft])

  const dirty = useMemo(
    () => value !== undefined && draft !== null && JSON.stringify(draft) !== JSON.stringify(value),
    [value, draft],
  )
  const invalid = useMemo(
    () =>
      draft?.prices.some(
        (p) =>
          p.provider.trim() === '' ||
          p.model.trim() === '' ||
          !numTextOk(String(p.inputPerMtok)) ||
          !numTextOk(String(p.outputPerMtok)),
      ),
    [draft],
  )

  if (value === undefined || draft === null) {
    return (
      <li className="dup-card">
        <p className="dup-readOnly">{t('loading')}</p>
      </li>
    )
  }

  const onSave = (): void => {
    setSaving(true)
    const revision = scope.getSnapshot().revision
    api
      .update({
        ns: 'dsh-plus-usage-panel',
        patch: { prices: draft.prices, currency: draft.currency, catalogProxy: draft.catalogProxy },
        ...(revision !== undefined ? { expectedRevision: revision } : {}),
      })
      .then(async (response) => {
        if (!response.result.ok) {
          throw new Error(response.result.error?.message ?? t('saveFailed'))
        }
        await scope.load()
        setStatus(IDLE_STATUS)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('saveFailed')}${message}` })
      })
      .finally(() => setSaving(false))
  }

  const onImport = (): void => {
    setImporting(true)
    fetchModelsDevRaw(MODELS_DEV_URL)
      .then((doc) => importPricesFromModelsDev(doc))
      .then(async ({ imported }) => {
        await scope.load()
        const next = scope.getSnapshot().value as ConfigValue | undefined
        if (next !== undefined) setDraft(structuredClone(next))
        setStatus({ kind: 'ok', text: t('importOk').replace('{n}', String(imported)) })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('importFailed')}${message}` })
      })
      .finally(() => setImporting(false))
  }

  const editPrice = (index: number, patch: Partial<ConfigValue['prices'][number]>): void => {
    setDraft({
      ...draft,
      prices: draft.prices.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    })
    setStatus(IDLE_STATUS)
  }

  const disabled = !snapshot.writable
  return (
    <CardChrome
      prefix="dup"
      title={t('cardTitle')}
      description={t('cardDescription')}
      open={open}
      onToggle={setOpen}
      statusBadge={{
        text: t(draft.prices.length > 0 ? 'enabledOn' : 'enabledOff'),
        on: draft.prices.length > 0,
      }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={[
        {
          key: 'import',
          label: t(importing ? 'importing' : 'importBtn'),
          disabled: disabled || importing,
          onClick: onImport,
        },
        {
          key: 'add',
          label: t('addPrice'),
          disabled,
          onClick: () => {
            setDraft({
              ...draft,
              prices: [
                ...draft.prices,
                {
                  provider: '',
                  model: '',
                  inputPerMtok: 0,
                  outputPerMtok: 0,
                  cacheReadPerMtok: 0,
                  cacheWritePerMtok: 0,
                },
              ],
            })
            setStatus(IDLE_STATUS)
          },
        },
        {
          key: 'discard',
          label: t('discard'),
          disabled: !dirty || saving,
          onClick: () => {
            setDraft(structuredClone(value))
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
      <TextField
        prefix="dup"
        id="dup-currency"
        label={t('currency')}
        value={draft.currency}
        disabled={disabled}
        onEdit={(v) => setDraft({ ...draft, currency: v })}
      />
      <TextField
        prefix="dup"
        id="dup-proxy"
        label={t('catalogProxyLabel')}
        hint={t('catalogProxyHint')}
        value={draft.catalogProxy}
        disabled={disabled}
        onEdit={(v) => setDraft({ ...draft, catalogProxy: v })}
      />
      {draft.prices.length === 0 ? <p className="dup-empty">{t('priceHint')}</p> : null}
      {draft.prices.map((price, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 价目草稿行无稳定 id，行序即身份（增删经整体回写）
        <div className="dup-priceRow" key={`price-${index}`}>
          <div className="dup-priceHead">
            <span className="dup-priceTitle">
              {price.provider}/{price.model}
            </span>
            <button
              type="button"
              className="dup-btn dup-btnGhost dup-btnSmall"
              disabled={disabled}
              onClick={() => {
                setDraft({ ...draft, prices: draft.prices.filter((_, i) => i !== index) })
                setStatus(IDLE_STATUS)
              }}
            >
              {t('removePrice')}
            </button>
          </div>
          <div className="dup-priceGrid">
            <label className="dup-mini">
              <span>{t('provider')}</span>
              <input
                className="dup-input dup-in"
                value={price.provider}
                disabled={disabled}
                onChange={(e) => editPrice(index, { provider: e.target.value })}
              />
            </label>
            <label className="dup-mini">
              <span>{t('model')}</span>
              <input
                className="dup-input dup-in"
                value={price.model}
                disabled={disabled}
                onChange={(e) => editPrice(index, { model: e.target.value })}
              />
            </label>
            <label className="dup-mini">
              <span>{t('inputPrice')}</span>
              <input
                className="dup-input dup-in"
                inputMode="decimal"
                value={String(price.inputPerMtok)}
                disabled={disabled}
                onChange={(e) => editPrice(index, { inputPerMtok: num(e.target.value) })}
              />
            </label>
            <label className="dup-mini">
              <span>{t('outputPrice')}</span>
              <input
                className="dup-input dup-in"
                inputMode="decimal"
                value={String(price.outputPerMtok)}
                disabled={disabled}
                onChange={(e) => editPrice(index, { outputPerMtok: num(e.target.value) })}
              />
            </label>
            <label className="dup-mini">
              <span>{t('cacheReadPrice')}</span>
              <input
                className="dup-input dup-in"
                inputMode="decimal"
                value={String(price.cacheReadPerMtok)}
                disabled={disabled}
                onChange={(e) => editPrice(index, { cacheReadPerMtok: num(e.target.value) })}
              />
            </label>
            <label className="dup-mini">
              <span>{t('cacheWritePrice')}</span>
              <input
                className="dup-input dup-in"
                inputMode="decimal"
                value={String(price.cacheWritePerMtok)}
                disabled={disabled}
                onChange={(e) => editPrice(index, { cacheWritePerMtok: num(e.target.value) })}
              />
            </label>
          </div>
        </div>
      ))}
    </CardChrome>
  )
}
