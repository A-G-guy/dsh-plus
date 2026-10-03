/**
 * 价目配置卡片：经 injectPluginConfigCard 注册（legacy settings.plugin.item
 * 与 0.1.6-alpha.2 插件页 plugins.row.config / plugins.bundle.config，view 分发
 * summary/page）。
 * 价目行编辑（provider/model/四价）+ models.dev 一键导入（host 后台拉取，
 * 前端轮询目录状态：refreshing 期间禁用按钮，完成后经缓存文档折算导入）。
 * @module usage-panel/client/price-card
 */

import {
  type CardAction,
  CardChrome,
  CardLoading,
  type CardStatusState,
  cardVariantFor,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  fetchCatalogState,
  importPricesFromModelsDev,
  refreshCatalog,
  type UsageCatalogStateWithPrices,
} from './api.ts'
import type { Translate } from './i18n.ts'
import { PriceGlobalFields, PriceHints } from './price-fields.tsx'
import { PriceRowEditor } from './price-rows.tsx'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

/**
 * settings 命名空间的解析值。
 * 用类型别名而非 interface：别名带隐式索引签名，可直接交给
 * `NamespaceSettingsApi.update`（形参为 Record<string, unknown>）。
 */
type ConfigValue = {
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
  /** 历史会话自动增量同步间隔（分钟，0 = 仅启动时同步一次）。 */
  autoSyncMinutes: number
  /** models.dev 目录自动刷新间隔（小时，0 = 仅启动时拉取一次）。 */
  catalogRefreshHours: number
}

/** 编辑草稿：价目与字符串字段原样保留，数值字段以文本承载（保存时校验并折算）。 */
interface Draft {
  prices: ConfigValue['prices']
  currency: string
  catalogProxy: string
  autoSyncMinutes: string
  catalogRefreshHours: string
}

function draftFrom(value: ConfigValue): Draft {
  return {
    prices: structuredClone(value.prices),
    currency: value.currency,
    catalogProxy: value.catalogProxy,
    autoSyncMinutes: String(value.autoSyncMinutes),
    catalogRefreshHours: String(value.catalogRefreshHours),
  }
}

/** 草稿 → 提交形状：数值字段已由 invalid 校验保证为合法非负整数。 */
function toPatch(draft: Draft): ConfigValue {
  return {
    prices: draft.prices,
    currency: draft.currency,
    catalogProxy: draft.catalogProxy,
    autoSyncMinutes: Number(draft.autoSyncMinutes),
    catalogRefreshHours: Number(draft.catalogRefreshHours),
  }
}

function numTextOk(text: string): boolean {
  return /^\d+(\.\d+)?$/.test(text.trim())
}

/** 非负整数文本（间隔类字段：不接受小数）。 */
function intTextOk(text: string): boolean {
  return /^\d+$/.test(text.trim())
}

/** 价目存储状态（导入文件条数/生效条数）：徽标与导入提示用；summary 视图不取。 */
function usePricesState(view: PluginConfigViewProps['view']): {
  prices: UsageCatalogStateWithPrices['prices'] | null
  setPrices(next: UsageCatalogStateWithPrices['prices']): void
} {
  const [pricesState, setPricesState] = useState<UsageCatalogStateWithPrices['prices'] | null>(null)
  useEffect(() => {
    if (view === 'summary') return
    let alive = true
    fetchCatalogState()
      .then((state) => {
        if (alive) setPricesState(state.prices)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [view])
  return { prices: pricesState, setPrices: setPricesState }
}

/** 导入流程：触发 host 后台刷新 → 轮询目录状态（refreshing 结束）→ 缓存文档折算导入。 */
function runImport(
  t: Translate,
  onPrices: (prices: UsageCatalogStateWithPrices['prices']) => void,
  onStatus: (status: CardStatusState) => void,
  onSettled: () => void,
): void {
  refreshCatalog()
    .catch(() => {})
    .then(() => fetchCatalogState())
    .then((state) => {
      if (!state.refreshing) return state
      const deadline = Date.now() + 60_000
      const poll = (): Promise<typeof state> =>
        new Promise((resolve) => setTimeout(resolve, 1500))
          .then(fetchCatalogState)
          .then((next) => (next.refreshing && Date.now() < deadline ? poll() : next))
      return poll()
    })
    .then(() => importPricesFromModelsDev())
    .then(({ imported, prices }) => {
      // 导入只写独立存储（不碰行级 config）：不重置 draft，避免冲掉未保存的手工编辑。
      onPrices(prices)
      onStatus({ kind: 'ok', text: t('importOk').replace('{n}', String(imported)) })
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      onStatus({ kind: 'error', text: `${t('importFailed')}${message}` })
    })
    .finally(onSettled)
}

/** 卡片动作：导入参考价、添加手工条目、放弃、保存。 */
function cardActions(options: {
  t: Translate
  dirty: boolean
  invalid: boolean
  saving: boolean
  importing: boolean
  disabled: boolean
  onImport(): void
  onAdd(): void
  onDiscard(): void
  onSave(): void
}): CardAction[] {
  const { t } = options
  return [
    {
      key: 'import',
      label: t(options.importing ? 'importing' : 'importBtn'),
      disabled: options.disabled || options.importing,
      onClick: options.onImport,
    },
    { key: 'add', label: t('addPrice'), disabled: options.disabled, onClick: options.onAdd },
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

/** 保存：整段价目 + 全局字段一次提交（revision fencing），成功后重新装载 Host 值。 */
function saveDraft(options: {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
  patch: Record<string, unknown>
  onSaved(): void
  onStatus(status: CardStatusState): void
  onSettled(): void
}): void {
  const revision = options.scope.getSnapshot().revision
  options.api
    .update(options.patch, revision)
    .then(async () => {
      await options.scope.load()
      options.onSaved()
      options.onStatus(IDLE_STATUS)
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      options.onStatus({ kind: 'error', text: `${options.t('saveFailed')}${message}` })
    })
    .finally(options.onSettled)
}

/** 价目行的 React key：草稿行无稳定 id，行序即身份（增删经整体回写）。 */
function priceRowKey(index: number): string {
  return `price-${index}`
}

/** 空白手工价目：行序即身份，保存时整体回写。 */
function emptyPrice(): ConfigValue['prices'][number] {
  return {
    provider: '',
    model: '',
    inputPerMtok: 0,
    outputPerMtok: 0,
    cacheReadPerMtok: 0,
    cacheWritePerMtok: 0,
  }
}

/** 改写第 index 行价目（返回新草稿，不改入参）。 */
function editPrice(
  draft: Draft,
  index: number,
  patch: Partial<ConfigValue['prices'][number]>,
): Draft {
  return { ...draft, prices: draft.prices.map((p, i) => (i === index ? { ...p, ...patch } : p)) }
}

export function UsagePriceCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  // 0.1.6-alpha.2 插件页 page 视图为表单落地页，默认展开；旧槽位无 view，保持折叠。
  const [open, setOpen] = useState(props.view === 'page')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)
  const { prices: pricesState, setPrices } = usePricesState(props.view)

  useEffect(() => {
    if (value !== undefined && draft === null) setDraft(draftFrom(value))
  }, [value, draft])

  const dirty = useMemo(
    () =>
      value !== undefined &&
      draft !== null &&
      JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFrom(value))),
    [value, draft],
  )
  const invalid = useMemo(
    () =>
      draft === null ||
      !intTextOk(draft.autoSyncMinutes) ||
      !intTextOk(draft.catalogRefreshHours) ||
      draft.prices.some(
        (p) =>
          p.provider.trim() === '' ||
          p.model.trim() === '' ||
          !numTextOk(String(p.inputPerMtok)) ||
          !numTextOk(String(p.outputPerMtok)),
      ),
    [draft],
  )

  // 插件页 summary 视图只出一行简介（hooks 已全部落定，可安全提前返回）。
  if (props.view === 'summary') return t('cardSummary')

  // 插件页 page 视图内嵌宿主页面容器（已带页面级内边距与标题），用无边框分节。
  const variant = cardVariantFor(props.view)

  if (value === undefined || draft === null) {
    return <CardLoading prefix="dup" variant={variant} text={t('loading')} />
  }

  const onSave = (): void => {
    setSaving(true)
    saveDraft({
      t,
      scope,
      api,
      patch: toPatch(draft),
      onSaved: () => {},
      onStatus: setStatus,
      onSettled: () => setSaving(false),
    })
  }

  const onImport = (): void => {
    setImporting(true)
    runImport(t, setPrices, setStatus, () => setImporting(false))
  }

  const disabled = !snapshot.writable
  // 生效条数 = 导入（独立文件）+ 手工合并后；存储状态未取到时退化为手工条数。
  const priced = pricesState !== null ? pricesState.effectiveCount : draft.prices.length
  return (
    <CardChrome
      prefix="dup"
      title={t('cardTitle')}
      description={t('cardDescription')}
      open={open}
      onToggle={setOpen}
      variant={variant}
      statusBadge={{
        text: t(priced > 0 ? 'enabledOn' : 'enabledOff'),
        on: priced > 0,
      }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={cardActions({
        t,
        dirty,
        invalid,
        saving,
        importing,
        disabled,
        onImport,
        onAdd: () => {
          setDraft({ ...draft, prices: [...draft.prices, emptyPrice()] })
          setStatus(IDLE_STATUS)
        },
        onDiscard: () => {
          setDraft(draftFrom(value))
          setStatus(IDLE_STATUS)
        },
        onSave,
      })}
    >
      <PriceGlobalFields
        t={t}
        draft={draft}
        disabled={disabled}
        onEdit={(patch) => setDraft({ ...draft, ...patch })}
      />
      <PriceHints
        t={t}
        importedCount={pricesState?.importedCount ?? 0}
        hasStoredState={pricesState !== null}
        manualCount={draft.prices.length}
      />
      {draft.prices.map((price, index) => (
        <PriceRowEditor
          // 价目草稿行无稳定 id：行序即身份（增删经整体回写，重排不保留行内状态）
          key={priceRowKey(index)}
          price={price}
          disabled={disabled}
          t={t}
          onEdit={(patch) => {
            setDraft(editPrice(draft, index, patch))
            setStatus(IDLE_STATUS)
          }}
          onRemove={() => {
            setDraft({ ...draft, prices: draft.prices.filter((_, i) => i !== index) })
            setStatus(IDLE_STATUS)
          }}
        />
      ))}
    </CardChrome>
  )
}
