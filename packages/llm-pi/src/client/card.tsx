/**
 * 「LLM 路由」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 顶部：enabled / catalogUrl / catalogRefreshHours / 只读状态行（kitSource、
 * modelsDevStatus，来自模型目录端点）+ 保存（settings.update 全量深合并）与
 * 错误/成功提示；下方为 providers 路由列表（新增/删除/字段编辑/compat/模型
 * 目录，见 views/）。外壳与基础控件走 @dsh-plus/shared/client 套件。
 * @module llm-pi/client/card
 */

import {
  CardChrome,
  type CardStatusState,
  CheckRow,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type Scope,
  TextField,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type ConfigValue, fetchCatalog, refreshCatalog, type WireModelsDevStatus } from './api.ts'
import {
  type Draft,
  draftFromValue,
  emptyProviderDraft,
  numTextOk,
  type ProviderDraft,
  toPatch,
} from './draft.ts'
import { ProvidersSection } from './views/providers.tsx'

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: NamespaceSettingsApi
}

function modelsDevText(status: WireModelsDevStatus | null, t: (key: string) => string): string {
  if (status === null) return t('modelsDevEmpty')
  if (status.error !== null) return `${t('modelsDevError')}${status.error}`
  if (status.fetchedAt === null) return t('modelsDevEmpty')
  return `${t('modelsDevStatusLine')}：${status.providers} 个 provider，快照 ${status.fetchedAt}`
}

export function LlmPiCard(props: CardProps): ReactElement | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [kitSource, setKitSource] = useState<string | null>(null)
  const [modelsDevStatus, setModelsDevStatus] = useState<WireModelsDevStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)

  // 首次拿到解析值后播种草稿；后续 Host 更新不覆盖在途编辑（与官方 staged 表单一致）。
  useEffect(() => {
    if (value === undefined || draft !== null) return
    setDraft(draftFromValue(value))
  }, [value, draft])

  // 运行期诊断行（kitSource / models-dev 状态）来自模型目录端点，非配置数据。
  useEffect(() => {
    let alive = true
    fetchCatalog('', 'models-dev')
      .then((result) => {
        if (!alive) return
        setKitSource(result.kitSource ?? null)
        setModelsDevStatus(result.status ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

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

  if (value === undefined || draft === null) {
    return (
      <li className="lpc-card">
        <p className="lpc-readOnly">{t('loading')}</p>
      </li>
    )
  }

  const setProvider = (route: string, patch: Partial<ProviderDraft>): void => {
    const current = draft.providers[route] ?? emptyProviderDraft()
    setDraft({
      ...draft,
      providers: { ...draft.providers, [route]: { ...current, ...patch } },
    })
    setStatus(IDLE_STATUS)
  }
  const onAddRoute = (key: string): void => {
    setDraft({
      ...draft,
      providers: { ...draft.providers, [key]: emptyProviderDraft() },
    })
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
      open={open}
      onToggle={setOpen}
      statusBadge={{ text: t(draft.enabled ? 'enabledOn' : 'enabledOff'), on: draft.enabled }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={[
        {
          key: 'refresh',
          label: t(refreshing ? 'refreshingCatalog' : 'refreshCatalog'),
          disabled: disabled || refreshing,
          onClick: onRefreshCatalog,
        },
        {
          key: 'discard',
          label: t('discard'),
          disabled: !dirty || saving,
          onClick: onDiscard,
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
      <CheckRow
        prefix="lpc"
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
        prefix="lpc"
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
        prefix="lpc"
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
        prefix="lpc"
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
      <p className="lpc-statusRow">
        {t('kitSource')}：{kitSource ?? ''}
      </p>
      <div className="lpc-statusRow">
        <span>
          {t('modelsDevStatus')}：{modelsDevText(modelsDevStatus, t)}
        </span>
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
    </CardChrome>
  )
}
