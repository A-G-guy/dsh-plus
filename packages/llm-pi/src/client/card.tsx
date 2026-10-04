/**
 * 「LLM 路由」配置卡片：经 injectPluginConfigCard 注册（插件页
 * plugins.row.config / plugins.bundle.config，view 分发 summary/page）。
 *
 * 页面结构（自上而下，除根字段外**默认全部收起**，避免长列表划不到头）：
 * 1. 根字段：启用开关 + 运行期状态行（生效版本/安装树/目录规模/协议/compat 来源/诊断）；
 * 2. 「内置模型目录」浏览器（折叠小节，默认收起）：搜索/筛选/复制路径 id/
 *    一键把 `{id, extends}` 加到目标 route（添加后自动展开该 route 并回显）；
 * 3. Provider 路由列表（每 route 收起；route 内模型行同样默认收起）。
 *
 * 数据来源：配置读写走官方 remote.settings（scope/api）；运行期事实与目录搜索
 * 走本插件 `/catalog` 端点（浏览器半读不到 pi-ai 包）。草稿/保存与目录索引各由
 * 本文件的 hook 承担，全部状态（浏览器开合、目标 route、route 展开态）在卡片持有，
 * 子组件受控。
 * @module llm-pi/client/card
 */

import {
  type CardAction,
  CardChrome,
  CardLoading,
  type CardStatusState,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type CatalogMeta, type ConfigValue, fetchCatalogMeta, type WireModelInfo } from './api.ts'
import { installCompatFields, installProtocols } from './constants.ts'
import {
  addModelEntry,
  type Draft,
  draftFromValue,
  emptyProviderDraft,
  type ProviderDraft,
  toPatch,
} from './draft.ts'
import { CollapseSection } from './fields.tsx'
import type { Translate } from './i18n.ts'
import { RootFields } from './root-fields.tsx'
import { type ApiIndex, routeApiFacts, targetRoutes } from './route-fit.ts'
import { CatalogBrowser } from './views/catalog-browser.tsx'
import { ProvidersSection } from './views/providers.tsx'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

/** 运行期事实 + 目录索引：卡片挂载拉一次（同时安装协议集合与 compat 字段表）。 */
function useCatalogMeta(): { meta: CatalogMeta | null; error: string } {
  const [meta, setMeta] = useState<CatalogMeta | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    fetchCatalogMeta()
      .then((result) => {
        if (!alive) return
        installProtocols(result.kit.protocols)
        installCompatFields(result.compat.fields)
        setMeta(result)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [])
  return { meta, error }
}

/**
 * 草稿与保存：首次拿到解析值后播种草稿；后续 Host 更新不覆盖在途编辑
 * （与官方 staged 表单一致）。dirty 由"提交形状"双向比较得出。
 */
function useCardDraft(options: {
  value: ConfigValue | undefined
  scope: Scope
  api: NamespaceSettingsApi
  t: Translate
}) {
  const { value, scope, api, t } = options
  const [draft, setDraft] = useState<Draft | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)

  useEffect(() => {
    if (value === undefined || draft !== null) return
    setDraft(draftFromValue(value))
  }, [value, draft])

  const dirty = useMemo(
    () =>
      value !== undefined &&
      draft !== null &&
      JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFromValue(value))),
    [value, draft],
  )
  const onSave = (): void => {
    if (draft === null) return
    setSaving(true)
    const revision = scope.getSnapshot().revision
    api
      .update(toPatch(draft) as unknown as Record<string, unknown>, revision)
      .then(async () => {
        await scope.load()
        const next = scope.getSnapshot().value as ConfigValue | undefined
        if (next !== undefined) setDraft(draftFromValue(next))
        setEpoch((current) => current + 1)
        setStatus({ kind: 'ok', text: t('saveOk') })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('saveFailed')}${message}` })
      })
      .finally(() => setSaving(false))
  }
  const onDiscard = (): void => {
    if (value === undefined) return
    setDraft(draftFromValue(value))
    setEpoch((current) => current + 1)
    setStatus(IDLE_STATUS)
  }
  return {
    draft,
    setDraft,
    dirty,
    saving,
    status,
    idle: () => setStatus(IDLE_STATUS),
    epoch,
    onSave,
    onDiscard,
  }
}

/** 路由级草稿改写：改字段 / 新增 route / 删除 route（返回新草稿，不改入参）。 */
function withProviderPatch(draft: Draft, route: string, patch: Partial<ProviderDraft>): Draft {
  const current = draft.providers[route] ?? emptyProviderDraft()
  return { ...draft, providers: { ...draft.providers, [route]: { ...current, ...patch } } }
}

function withNewRoute(draft: Draft, key: string): Draft {
  return { ...draft, providers: { ...draft.providers, [key]: emptyProviderDraft() } }
}

function withoutRoute(draft: Draft, route: string): Draft {
  const next = { ...draft.providers }
  delete next[route]
  return { ...draft, providers: next }
}

/** 卡片动作：放弃、保存（模型目录已唯一来自 pi-ai，无可拉取项）。 */
function cardActions(options: {
  t: Translate
  dirty: boolean
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
      disabled: !options.dirty || options.saving || options.disabled,
      onClick: options.onSave,
    },
  ]
}

/** 打开浏览器时的目标 route 选择：优先当前目标，否则第一个候选。 */
function pickTarget(targets: readonly string[], preferred: string): string {
  if (preferred !== '' && targets.includes(preferred)) return preferred
  return targets[0] ?? ''
}

export function LlmPiCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const { draft, setDraft, dirty, saving, status, idle, epoch, onSave, onDiscard } = useCardDraft({
    value,
    scope,
    api,
    t,
  })
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserTarget, setBrowserTarget] = useState('')
  const [openRoutes, setOpenRoutes] = useState<Record<string, boolean>>({})
  const { meta, error: metaError } = useCatalogMeta()

  // 插件页 summary 视图只出一行简介（hooks 已全部落定，可安全提前返回）。
  if (props.view === 'summary') return t('summaryLine')

  if (value === undefined || draft === null) {
    return <CardLoading prefix="lpc" text={t('loading')} />
  }

  const apis: ApiIndex = meta?.apis ?? {}
  const targets = targetRoutes(draft.providers)
  const target = pickTarget(targets, browserTarget)
  const openBrowserFor = (route: string): void => {
    setBrowserTarget(route)
    setBrowserOpen(true)
  }
  const onAddRoute = (key: string): void => {
    setDraft(withNewRoute(draft, key))
    setOpenRoutes((prev) => ({ ...prev, [key]: true }))
    setBrowserTarget((prev) => (prev === '' ? key : prev))
    idle()
  }
  /**
   * 目录一键添加：把 `{id, extends: 'provider/model'}` 写进目标 route 草稿
   * （不预填 name/容量——继承才能跟随 pi-ai 目录升级），并展开该 route 给出反馈。
   */
  const onAddModel = (route: string, model: WireModelInfo): boolean => {
    const result = addModelEntry(draft, route, model)
    if (!result.added) return false
    setDraft(result.draft)
    setOpenRoutes((prev) => ({ ...prev, [route]: true }))
    idle()
    return true
  }

  const disabled = !snapshot.writable
  return (
    <CardChrome
      prefix="lpc"
      title={t('title')}
      description={t('description')}
      statusBadge={{ text: t(draft.enabled ? 'enabledOn' : 'enabledOff'), on: draft.enabled }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={cardActions({ t, dirty, saving, disabled, onDiscard, onSave })}
    >
      <RootFields
        t={t}
        draft={draft}
        disabled={disabled}
        kit={meta?.kit ?? null}
        kitError={metaError}
        onEdit={(patch) => {
          setDraft({ ...draft, ...patch })
          idle()
        }}
      />
      <CollapseSection
        id="lpc-catalog-browser"
        title={t('browserGroup')}
        defaultOpen={false}
        open={browserOpen}
        onToggle={() => setBrowserOpen((open) => !open)}
        meta={meta === null ? '' : `${meta.kit.catalog.models}`}
      >
        <CatalogBrowser
          t={t}
          targets={targets}
          apis={apis}
          providers={meta?.providers ?? []}
          target={target}
          onTargetChange={setBrowserTarget}
          providerOf={(route) => draft.providers[route]}
          routeApiOf={(route) => {
            const provider = draft.providers[route]
            return provider === undefined ? undefined : routeApiFacts(provider, apis).api
          }}
          onAdd={onAddModel}
          disabled={disabled}
          {...(metaError === '' ? {} : { metaError })}
        />
      </CollapseSection>
      <ProvidersSection
        providers={draft.providers}
        openRoutes={openRoutes}
        epoch={epoch}
        disabled={disabled}
        t={t}
        onAddRoute={onAddRoute}
        onRemoveRoute={(route) => {
          setDraft(withoutRoute(draft, route))
          idle()
        }}
        onPatchProvider={(route, patch) => {
          setDraft(withProviderPatch(draft, route, patch))
          idle()
        }}
        onToggleRoute={(route, open) => setOpenRoutes((prev) => ({ ...prev, [route]: open }))}
        onCollapseAll={() => setOpenRoutes({})}
        onExpandAll={() =>
          setOpenRoutes(
            Object.fromEntries(Object.keys(draft.providers).map((route) => [route, true])),
          )
        }
        onAddFromCatalog={openBrowserFor}
      />
    </CardChrome>
  )
}
