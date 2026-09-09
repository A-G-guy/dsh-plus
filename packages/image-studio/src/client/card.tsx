/**
 * 配置卡片（settings.plugin.item，key = settings 命名空间）：
 * 三组预设（提供商/参数/提示词）+ 高级项（并发/超时/代理/画廊上限）的
 * staged draft 编辑；提供商预设逐条附 API Key 管理（凭据端点，值不回显）。
 * JSON 字段（extraHeaders/paramSpecs）以文本镜像编辑，保存时解析 +
 * validateParamSpecs 本地校验，非法即拦在保存前。
 * @module image-studio/client/card
 */
import {
  CardChrome,
  type CardStatusState,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type Scope,
  TextField,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type { ImageStudioConfig } from '../config.ts'
import { credentialRefNameOf, isValidPresetId } from '../credentials.ts'
import { validateParamSpecs } from '../params/spec.ts'
import { fetchCredentialStatus, fetchProviders, setCredential, unsetCredential } from './api.ts'
import type { Translate } from './i18n.ts'

export interface CardProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

/** 编辑态草稿：JSON 字段与数值以文本承载（保存时解析校验）。 */
interface ProviderDraft {
  id: string
  name: string
  protocol: string
  baseUrl: string
  model: string
  extraHeadersText: string
}

interface ParamDraft {
  id: string
  name: string
  endpoint: string
  specsText: string
}

interface PromptDraft {
  id: string
  name: string
  text: string
}

interface Draft {
  providers: ProviderDraft[]
  params: ParamDraft[]
  prompts: PromptDraft[]
  maxConcurrent: string
  requestTimeoutMs: string
  proxy: string
  galleryMaxItems: string
}

/** 配置值 → 编辑草稿。 */
function draftOf(value: ImageStudioConfig): Draft {
  return {
    providers: value.providerPresets.map((p) => ({
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      model: p.model,
      extraHeadersText: JSON.stringify(p.extraHeaders ?? {}, null, 2),
    })),
    params: value.paramPresets.map((p) => ({
      id: p.id,
      name: p.name,
      endpoint: p.endpoint,
      specsText: JSON.stringify(p.paramSpecs ?? {}, null, 2),
    })),
    prompts: value.promptPresets.map((p) => ({ id: p.id, name: p.name, text: p.text })),
    maxConcurrent: String(value.maxConcurrent),
    requestTimeoutMs: String(value.requestTimeoutMs),
    proxy: value.proxy,
    galleryMaxItems: String(value.galleryMaxItems),
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 草稿 → settings 载荷（边界校验：JSON 解析、参数表校验、预设 id 形态）。 */
function payloadOf(draft: Draft): Record<string, unknown> {
  const providers = draft.providers.map((p) => {
    if (!isValidPresetId(p.id)) throw new Error(p.id)
    return {
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      model: p.model,
      credentialRef: credentialRefNameOf(p.id),
      extraHeaders: parseJson(p.extraHeadersText, p.id) as Record<string, string>,
    }
  })
  const params = draft.params.map((p) => ({
    id: p.id,
    name: p.name,
    endpoint: p.endpoint,
    paramSpecs: validateParamSpecs(parseJson(p.specsText, p.id)),
  }))
  return {
    promptPresets: draft.prompts.map((p) => ({ id: p.id, name: p.name, text: p.text })),
    paramPresets: params,
    providerPresets: providers,
    maxConcurrent: Math.max(0, Math.floor(Number(draft.maxConcurrent) || 0)),
    requestTimeoutMs: Math.max(10_000, Math.floor(Number(draft.requestTimeoutMs) || 300_000)),
    proxy: draft.proxy,
    galleryMaxItems: Math.max(0, Math.floor(Number(draft.galleryMaxItems) || 0)),
  }
}

/** 单个提供商预设的 API Key 行（describe 徽标 + 设置/删除，值不回显）。 */
function CredentialRow(props: { t: Translate; presetId: string; disabled: boolean }): ReactElement {
  const { t, presetId, disabled } = props
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isValidPresetId(presetId)) return
    let alive = true
    fetchCredentialStatus(presetId)
      .then((res) => {
        if (alive) setConfigured(res.configured)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [presetId])

  const act = (fn: () => Promise<unknown>): void => {
    setBusy(true)
    fn()
      .then(() => fetchCredentialStatus(presetId))
      .then((res) => {
        setConfigured(res.configured)
        setValue('')
      })
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  return (
    <div className="imsc-credRow">
      <input
        className="imsc-input"
        type="password"
        autoComplete="off"
        placeholder={t('card.credential.placeholder')}
        aria-label={t('card.credential.label')}
        value={value}
        disabled={disabled || busy}
        onChange={(event) => setValue(event.target.value)}
      />
      {configured !== null ? (
        <span className={`imsc-badge ${configured ? 'imsc-badgeSet' : 'imsc-badgeUnset'}`}>
          {t(configured ? 'card.credential.configured' : 'card.credential.unconfigured')}
        </span>
      ) : null}
      <button
        type="button"
        className="imsc-btn imsc-btnGhost"
        disabled={disabled || busy || value === '' || !isValidPresetId(presetId)}
        onClick={() => act(() => setCredential(presetId, value))}
      >
        {t('card.credential.set')}
      </button>
      <button
        type="button"
        className="imsc-btn imsc-btnGhost"
        disabled={disabled || busy || configured !== true || !isValidPresetId(presetId)}
        onClick={() => act(() => unsetCredential(presetId))}
      >
        {t('card.credential.unset')}
      </button>
    </div>
  )
}

export function StudioConfigCard(props: CardProps): ReactElement | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ImageStudioConfig | undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [baseline, setBaseline] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)
  const [protocols, setProtocols] = useState<Array<{ id: string; label: string }>>([])

  useEffect(() => {
    fetchProviders()
      .then((res) => setProtocols(res.protocols.map((p) => ({ id: p.id, label: p.label }))))
      .catch(() => {})
  }, [])

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

  if (value === undefined || draft === null) {
    return (
      <li className="imsc-card">
        <p className="imsc-loading">{t('common.loading')}</p>
      </li>
    )
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
  const patchProvider = (index: number, next: Partial<ProviderDraft>): void =>
    patch({ providers: draft.providers.map((p, i) => (i === index ? { ...p, ...next } : p)) })
  const patchParam = (index: number, next: Partial<ParamDraft>): void =>
    patch({ params: draft.params.map((p, i) => (i === index ? { ...p, ...next } : p)) })
  const patchPrompt = (index: number, next: Partial<PromptDraft>): void =>
    patch({ prompts: draft.prompts.map((p, i) => (i === index ? { ...p, ...next } : p)) })

  return (
    <CardChrome
      prefix="imsc"
      title={t('card.title')}
      description={t('card.description')}
      open={open}
      onToggle={setOpen}
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
      actions={[
        {
          key: 'discard',
          label: t('card.discard'),
          disabled: !dirty || saving,
          onClick: () => {
            const restored = draftOf(value)
            setDraft(restored)
            setBaseline(JSON.stringify(restored))
            setStatus(IDLE_STATUS)
          },
        },
        {
          key: 'save',
          label: t(saving ? 'common.saving' : 'card.save'),
          variant: 'primary',
          disabled: !dirty || saving || disabled,
          onClick: onSave,
        },
      ]}
    >
      <h4 className="imsc-groupTitle">{t('card.providers')}</h4>
      {draft.providers.map((provider, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 草稿行无稳定 id（id 字段本身可编辑），行序即身份
        <div className="imsc-presetBox" key={`provider-${index}`}>
          <div className="imsc-presetHead">
            <span className="imsc-presetName">{provider.name || provider.id || '—'}</span>
            <button
              type="button"
              className="imsc-btn imsc-btnGhost"
              disabled={disabled}
              onClick={() => patch({ providers: draft.providers.filter((_, i) => i !== index) })}
            >
              {t('common.delete')}
            </button>
          </div>
          <div className="imsc-grid2">
            <TextField
              prefix="imsc"
              id={`imsc-pid-${index}`}
              label={t('card.field.id')}
              hint={t('card.idHint')}
              value={provider.id}
              invalid={provider.id !== '' && !isValidPresetId(provider.id)}
              invalidLabel={t('card.idInvalid')}
              disabled={disabled}
              onEdit={(v) => patchProvider(index, { id: v })}
            />
            <TextField
              prefix="imsc"
              id={`imsc-pname-${index}`}
              label={t('card.field.name')}
              value={provider.name}
              disabled={disabled}
              onEdit={(v) => patchProvider(index, { name: v })}
            />
          </div>
          <div className="imsc-grid2">
            <div className="imsc-field">
              <div className="imsc-head">
                <label className="imsc-label" htmlFor={`imsc-pproto-${index}`}>
                  {t('card.field.protocol')}
                </label>
              </div>
              <select
                id={`imsc-pproto-${index}`}
                className="imsc-select"
                value={provider.protocol}
                disabled={disabled}
                onChange={(event) => patchProvider(index, { protocol: event.target.value })}
              >
                {(protocols.length > 0
                  ? protocols
                  : [{ id: provider.protocol, label: provider.protocol }]
                ).map((protocol) => (
                  <option key={protocol.id} value={protocol.id}>
                    {protocol.label}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              prefix="imsc"
              id={`imsc-pmodel-${index}`}
              label={t('card.field.model')}
              value={provider.model}
              disabled={disabled}
              onEdit={(v) => patchProvider(index, { model: v })}
            />
          </div>
          <TextField
            prefix="imsc"
            id={`imsc-purl-${index}`}
            label={t('card.field.baseUrl')}
            value={provider.baseUrl}
            disabled={disabled}
            onEdit={(v) => patchProvider(index, { baseUrl: v })}
          />
          <div className="imsc-field">
            <div className="imsc-head">
              <label className="imsc-label" htmlFor={`imsc-pheaders-${index}`}>
                {t('card.field.extraHeaders')}
              </label>
            </div>
            <textarea
              id={`imsc-pheaders-${index}`}
              className="imsc-textarea"
              value={provider.extraHeadersText}
              disabled={disabled}
              onChange={(event) => patchProvider(index, { extraHeadersText: event.target.value })}
            />
          </div>
          <CredentialRow t={t} presetId={provider.id} disabled={disabled} />
        </div>
      ))}
      <button
        type="button"
        className="imsc-btn imsc-btnGhost"
        disabled={disabled}
        onClick={() =>
          patch({
            providers: [
              ...draft.providers,
              {
                id: '',
                name: '',
                protocol: protocols[0]?.id ?? 'openai-images',
                baseUrl: '',
                model: '',
                extraHeadersText: '{}',
              },
            ],
          })
        }
      >
        {t('card.add')} · {t('card.providers')}
      </button>

      <h4 className="imsc-groupTitle">{t('card.prompts')}</h4>
      {draft.prompts.map((prompt, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 草稿行无稳定 id，行序即身份
        <div className="imsc-presetBox" key={`prompt-${index}`}>
          <div className="imsc-presetHead">
            <input
              className="imsc-input"
              aria-label={t('card.field.name')}
              value={prompt.name}
              disabled={disabled}
              onChange={(event) => patchPrompt(index, { name: event.target.value })}
            />
            <button
              type="button"
              className="imsc-btn imsc-btnGhost"
              disabled={disabled}
              onClick={() => patch({ prompts: draft.prompts.filter((_, i) => i !== index) })}
            >
              {t('common.delete')}
            </button>
          </div>
          <textarea
            className="imsc-textarea"
            aria-label={t('card.field.text')}
            value={prompt.text}
            disabled={disabled}
            onChange={(event) => patchPrompt(index, { text: event.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="imsc-btn imsc-btnGhost"
        disabled={disabled}
        onClick={() =>
          patch({
            prompts: [
              ...draft.prompts,
              { id: `prompt-${Date.now().toString(36)}`, name: '', text: '' },
            ],
          })
        }
      >
        {t('card.add')} · {t('card.prompts')}
      </button>

      <h4 className="imsc-groupTitle">{t('card.params')}</h4>
      {draft.params.map((param, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 草稿行无稳定 id，行序即身份
        <div className="imsc-presetBox" key={`param-${index}`}>
          <div className="imsc-presetHead">
            <input
              className="imsc-input"
              aria-label={t('card.field.name')}
              value={param.name}
              disabled={disabled}
              onChange={(event) => patchParam(index, { name: event.target.value })}
            />
            <select
              className="imsc-select"
              aria-label={t('card.field.endpoint')}
              value={param.endpoint}
              disabled={disabled}
              onChange={(event) => patchParam(index, { endpoint: event.target.value })}
            >
              <option value="generation">{t('tab.generation')}</option>
              <option value="edit">{t('tab.edit')}</option>
            </select>
            <button
              type="button"
              className="imsc-btn imsc-btnGhost"
              disabled={disabled}
              onClick={() => patch({ params: draft.params.filter((_, i) => i !== index) })}
            >
              {t('common.delete')}
            </button>
          </div>
          <textarea
            className="imsc-textarea"
            aria-label={t('card.field.paramSpecs')}
            placeholder='{ "size": { "enabled": true, "value": "1024x1024" } }'
            value={param.specsText}
            disabled={disabled}
            onChange={(event) => patchParam(index, { specsText: event.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="imsc-btn imsc-btnGhost"
        disabled={disabled}
        onClick={() =>
          patch({
            params: [
              ...draft.params,
              {
                id: `param-${Date.now().toString(36)}`,
                name: '',
                endpoint: 'generation',
                specsText: '{}',
              },
            ],
          })
        }
      >
        {t('card.add')} · {t('card.params')}
      </button>

      <h4 className="imsc-groupTitle">{t('card.advanced')}</h4>
      <div className="imsc-grid2">
        <TextField
          prefix="imsc"
          id="imsc-conc"
          label={t('card.maxConcurrent')}
          numeric
          value={draft.maxConcurrent}
          disabled={disabled}
          onEdit={(v) => patch({ maxConcurrent: v })}
        />
        <TextField
          prefix="imsc"
          id="imsc-timeout"
          label={t('card.requestTimeoutMs')}
          numeric
          value={draft.requestTimeoutMs}
          disabled={disabled}
          onEdit={(v) => patch({ requestTimeoutMs: v })}
        />
      </div>
      <div className="imsc-grid2">
        <TextField
          prefix="imsc"
          id="imsc-proxy"
          label={t('card.proxy')}
          value={draft.proxy}
          disabled={disabled}
          onEdit={(v) => patch({ proxy: v })}
        />
        <TextField
          prefix="imsc"
          id="imsc-gmax"
          label={t('card.galleryMaxItems')}
          numeric
          value={draft.galleryMaxItems}
          disabled={disabled}
          onEdit={(v) => patch({ galleryMaxItems: v })}
        />
      </div>
    </CardChrome>
  )
}
