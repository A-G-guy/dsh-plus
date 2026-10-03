/**
 * 配置卡片（injectPluginConfigCard 三槽位，legacy key = settings 命名空间，
 * 0.1.6-alpha.2 起为插件页 row/bundle config，view 分发 summary/page）：
 * 三组预设（提供商/参数/提示词）+ 高级项（并发/超时/代理/画廊上限）的
 * staged draft 编辑；提供商预设逐条附 API Key 管理（凭据端点，值不回显）。
 * JSON 字段（extraHeaders/paramSpecs）以文本镜像编辑，保存时解析 +
 * validateParamSpecs 本地校验，非法即拦在保存前。
 * 草稿类型与纯转换在 ./draft.ts，三组预设编辑区在 ./preset-sections.tsx。
 * @module image-studio/client/card
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
  TextField,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type { ImageStudioConfig } from '../config.ts'
import { fetchProviders } from './api.ts'
import {
  type Draft,
  draftOf,
  type ParamDraft,
  type PromptDraft,
  type ProviderDraft,
  payloadOf,
} from './draft.ts'
import type { Translate } from './i18n.ts'
import {
  ParamPresetSection,
  PromptPresetSection,
  ProviderPresetSection,
} from './preset-sections.tsx'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

/** 协议目录（服务端 /providers）：驱动提供商预设的协议下拉。 */
function useProtocols(): Array<{ id: string; label: string }> {
  const [protocols, setProtocols] = useState<Array<{ id: string; label: string }>>([])
  useEffect(() => {
    fetchProviders()
      .then((res) => setProtocols(res.protocols.map((p) => ({ id: p.id, label: p.label }))))
      .catch(() => {})
  }, [])
  return protocols
}

/** 卡片动作：放弃（回到 Host 值并重置基线）与保存。 */
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
      label: t('card.discard'),
      disabled: !options.dirty || options.saving,
      onClick: options.onDiscard,
    },
    {
      key: 'save',
      label: t(options.saving ? 'common.saving' : 'card.save'),
      variant: 'primary',
      disabled: !options.dirty || options.saving || options.disabled,
      onClick: options.onSave,
    },
  ]
}

/** 高级项：并发 / 超时 / 代理 / 画廊上限 / 上传保留时长。 */
function AdvancedFields(props: {
  t: Translate
  draft: Draft
  disabled: boolean
  onPatch(patch: Partial<Draft>): void
}): ReactElement {
  const { t, draft, disabled, onPatch } = props
  return (
    <>
      <h4 className="imsc-groupTitle">{t('card.advanced')}</h4>
      <div className="imsc-grid2">
        <TextField
          prefix="imsc"
          id="imsc-conc"
          label={t('card.maxConcurrent')}
          numeric
          value={draft.maxConcurrent}
          disabled={disabled}
          onEdit={(v) => onPatch({ maxConcurrent: v })}
        />
        <TextField
          prefix="imsc"
          id="imsc-timeout"
          label={t('card.requestTimeoutMs')}
          numeric
          value={draft.requestTimeoutMs}
          disabled={disabled}
          onEdit={(v) => onPatch({ requestTimeoutMs: v })}
        />
      </div>
      <div className="imsc-grid2">
        <TextField
          prefix="imsc"
          id="imsc-proxy"
          label={t('card.proxy')}
          value={draft.proxy}
          disabled={disabled}
          onEdit={(v) => onPatch({ proxy: v })}
        />
        <TextField
          prefix="imsc"
          id="imsc-gmax"
          label={t('card.galleryMaxItems')}
          numeric
          value={draft.galleryMaxItems}
          disabled={disabled}
          onEdit={(v) => onPatch({ galleryMaxItems: v })}
        />
      </div>
      <TextField
        prefix="imsc"
        id="imsc-upload-ttl"
        label={t('card.uploadTtlHours')}
        numeric
        value={draft.uploadTtlHours}
        disabled={disabled}
        onEdit={(v) => onPatch({ uploadTtlHours: v })}
      />
    </>
  )
}

export function StudioConfigCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ImageStudioConfig | undefined
  // 0.1.6-alpha.2 插件页 page 视图为表单落地页，默认展开；旧槽位无 view，保持折叠。
  const [open, setOpen] = useState(props.view === 'page')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [baseline, setBaseline] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)
  const protocols = useProtocols()

  useEffect(() => {
    if (value === undefined || draft !== null) return
    const initial = draftOf(value)
    setDraft(initial)
    setBaseline(JSON.stringify(initial))
  }, [value, draft])

  const dirty = useMemo(
    () => draft !== null && JSON.stringify(draft) !== baseline,
    [draft, baseline],
  )

  // 插件页 summary 视图只出一行简介（hooks 已全部落定，可安全提前返回）。
  if (props.view === 'summary') return t('card.summary')

  // 插件页 page 视图内嵌宿主页面容器（已带页面级内边距与标题），用无边框分节。
  const variant = cardVariantFor(props.view)

  if (value === undefined || draft === null) {
    return <CardLoading prefix="imsc" variant={variant} text={t('common.loading')} />
  }

  const disabled = !snapshot.writable

  const onSave = (): void => {
    let payload: Record<string, unknown>
    try {
      payload = payloadOf(draft)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: `${t('card.specsInvalid')}${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }
    setSaving(true)
    api
      .update(payload, snapshot.revision)
      .then(() => scope.load())
      .then(() => {
        setBaseline(JSON.stringify(draft))
        setStatus({ kind: 'ok', text: t('card.saved') })
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          text: `${t('card.saveFailed')}${error instanceof Error ? error.message : String(error)}`,
        })
      })
      .finally(() => setSaving(false))
  }

  const patch = (next: Partial<Draft>): void => {
    setDraft({ ...draft, ...next })
    setStatus(IDLE_STATUS)
  }
  const sectionProps = {
    t,
    draft,
    disabled,
    protocols,
    onPatch: patch,
    onPatchProvider: (index: number, next: Partial<ProviderDraft>): void =>
      patch({ providers: draft.providers.map((p, i) => (i === index ? { ...p, ...next } : p)) }),
    onPatchParam: (index: number, next: Partial<ParamDraft>): void =>
      patch({ params: draft.params.map((p, i) => (i === index ? { ...p, ...next } : p)) }),
    onPatchPrompt: (index: number, next: Partial<PromptDraft>): void =>
      patch({ prompts: draft.prompts.map((p, i) => (i === index ? { ...p, ...next } : p)) }),
  }

  return (
    <CardChrome
      prefix="imsc"
      title={t('card.title')}
      description={t('card.description')}
      open={open}
      onToggle={setOpen}
      variant={variant}
      statusBadge={{
        text:
          draft.providers.length > 0
            ? t('card.badgeOn').replace('{n}', String(draft.providers.length))
            : t('card.badgeOff'),
        on: draft.providers.length > 0,
      }}
      dirty={dirty}
      dirtyLabel={t('common.unsaved')}
      readOnlyNotice={disabled ? t('card.readOnly') : undefined}
      status={status}
      actions={cardActions({
        t,
        dirty,
        saving,
        disabled,
        onDiscard: () => {
          const restored = draftOf(value)
          setDraft(restored)
          setBaseline(JSON.stringify(restored))
          setStatus(IDLE_STATUS)
        },
        onSave,
      })}
    >
      <ProviderPresetSection {...sectionProps} />
      <PromptPresetSection {...sectionProps} />
      <ParamPresetSection {...sectionProps} />
      <AdvancedFields t={t} draft={draft} disabled={disabled} onPatch={patch} />
    </CardChrome>
  )
}
