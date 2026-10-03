/**
 * 「LLM 路由」配置卡片：经 injectPluginConfigCard 注册（插件页
 * plugins.row.config / plugins.bundle.config，view 分发 summary/page）。
 * 顶部：enabled / catalogUrl / catalogRefreshHours / 只读状态行（kitSource、
 * modelsDevStatus，来自模型目录端点）+ 保存（settings.update 全量深合并）与
 * 错误/成功提示；下方为 providers 路由列表（新增/删除/字段编辑/compat/模型
 * 目录，见 views/）。外壳与基础控件走 @dsh-plus/shared/client 套件。
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
import { type ConfigValue, fetchCatalog, refreshCatalog, type WireModelsDevStatus } from './api.ts'
import { installCompatFields } from './constants.ts'
import {
  type Draft,
  draftFromValue,
  emptyProviderDraft,
  numTextOk,
  type ProviderDraft,
  toPatch,
} from './draft.ts'
import type { Translate } from './i18n.ts'
import { RootFields } from './root-fields.tsx'
import { ProvidersSection } from './views/providers.tsx'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

/** 运行期诊断行数据来源：模型目录端点（compat 字段表同批安装）。 */
function useRuntimeDiagnostics(): {
  kitSource: string | null
  modelsDevStatus: WireModelsDevStatus | null
  setModelsDevStatus(next: WireModelsDevStatus): void
} {
  const [kitSource, setKitSource] = useState<string | null>(null)
  const [modelsDevStatus, setModelsDevStatus] = useState<WireModelsDevStatus | null>(null)
  useEffect(() => {
    let alive = true
    fetchCatalog('', 'models-dev')
      .then((result) => {
        if (!alive) return
        setKitSource(result.kitSource ?? null)
        setModelsDevStatus(result.status ?? null)
        if (result.compat !== undefined) installCompatFields(result.compat.fields)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return { kitSource, modelsDevStatus, setModelsDevStatus }
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

/** 卡片动作：手动拉取目录、放弃、保存。 */
function cardActions(options: {
  t: Translate
  dirty: boolean
  invalid: boolean
  saving: boolean
  refreshing: boolean
  disabled: boolean
  onRefresh(): void
  onDiscard(): void
  onSave(): void
}): CardAction[] {
  const { t } = options
  return [
    {
      key: 'refresh',
      label: t(options.refreshing ? 'refreshingCatalog' : 'refreshCatalog'),
      disabled: options.disabled || options.refreshing,
      onClick: options.onRefresh,
    },
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

export function LlmPiCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [draft, setDraft] = useState<Draft | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)
  const { kitSource, modelsDevStatus, setModelsDevStatus } = useRuntimeDiagnostics()

  // 首次拿到解析值后播种草稿；后续 Host 更新不覆盖在途编辑（与官方 staged 表单一致）。
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
  const invalid = useMemo(() => {
    if (draft === null) return false
    return (
      !numTextOk(draft.catalogRefreshHours) ||
      Object.values(draft.providers).some((provider) =>
        provider.models.some((model) => model.id.trim() === ''),
      )
    )
  }, [draft])

  // 插件页 summary 视图只出一行简介（hooks 已全部落定，可安全提前返回）。
  if (props.view === 'summary') return t('summaryLine')

  if (value === undefined || draft === null) {
    return <CardLoading prefix="lpc" text={t('loading')} />
  }

  const setProvider = (route: string, patch: Partial<ProviderDraft>): void => {
    setDraft(withProviderPatch(draft, route, patch))
    setStatus(IDLE_STATUS)
  }
  const onAddRoute = (key: string): void => {
    setDraft(withNewRoute(draft, key))
    setStatus(IDLE_STATUS)
  }
  const onRemoveRoute = (route: string): void => {
    setDraft(withoutRoute(draft, route))
    setStatus(IDLE_STATUS)
  }
  const onSave = (): void => {
    setSaving(true)
    const revision = scope.getSnapshot().revision
    api
      .update(toPatch(draft) as unknown as Record<string, unknown>, revision)
      .then(async () => {
        await scope.load()
        const next = scope.getSnapshot().value as ConfigValue | undefined
        if (next !== undefined) setDraft(draftFromValue(next))
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
    setDraft(draftFromValue(value))
    setEpoch((value) => value + 1)
    setStatus(IDLE_STATUS)
  }
  const onRefreshCatalog = (): void => {
    setRefreshing(true)
    refreshCatalog()
      .then((result) => {
        setModelsDevStatus(result.status)
        setStatus({ kind: 'ok', text: t('refreshOk') })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('refreshFailed')}${message}` })
      })
      .finally(() => setRefreshing(false))
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
      actions={cardActions({
        t,
        dirty,
        invalid,
        saving,
        refreshing,
        disabled,
        onRefresh: onRefreshCatalog,
        onDiscard,
        onSave,
      })}
    >
      <RootFields
        t={t}
        draft={draft}
        disabled={disabled}
        kitSource={kitSource}
        modelsDevStatus={modelsDevStatus}
        onEdit={(patch) => {
          setDraft({ ...draft, ...patch })
          setStatus(IDLE_STATUS)
        }}
      />
      <ProvidersSection
        providers={draft.providers}
        epoch={epoch}
        disabled={disabled}
        t={t}
        onAddRoute={onAddRoute}
        onRemoveRoute={onRemoveRoute}
        onPatchProvider={setProvider}
      />
    </CardChrome>
  )
}
