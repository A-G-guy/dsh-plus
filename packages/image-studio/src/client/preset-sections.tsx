/**
 * 配置卡片的三组预设编辑区：提供商（含逐条 API Key 管理）、提示词、参数。
 * 从 card.tsx 拆出，避免单组件过长；草稿类型与纯转换在 ./draft.ts。
 * @module image-studio/client/preset-sections
 */
import { TextField } from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useState } from 'react'

import { isValidPresetId } from '../credentials.ts'
import { fetchCredentialStatus, setCredential, unsetCredential } from './api.ts'
import {
  type Draft,
  emptyParamDraft,
  emptyPromptDraft,
  emptyProviderDraft,
  type ParamDraft,
  type PromptDraft,
  type ProviderDraft,
} from './draft.ts'
import type { Translate } from './i18n.ts'

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

/** 三组预设编辑区共用的 props（各组按需取用其中一部分）。 */
export interface PresetSectionsProps {
  t: Translate
  draft: Draft
  disabled: boolean
  protocols: Array<{ id: string; label: string }>
  onPatch(patch: Partial<Draft>): void
  onPatchProvider(index: number, patch: Partial<ProviderDraft>): void
  onPatchParam(index: number, patch: Partial<ParamDraft>): void
  onPatchPrompt(index: number, patch: Partial<PromptDraft>): void
}

export function ProviderPresetSection(props: PresetSectionsProps): ReactElement {
  const { t, draft, disabled, protocols, onPatch, onPatchProvider } = props
  return (
    <>
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
              onClick={() => onPatch({ providers: draft.providers.filter((_, i) => i !== index) })}
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
              onEdit={(v) => onPatchProvider(index, { id: v })}
            />
            <TextField
              prefix="imsc"
              id={`imsc-pname-${index}`}
              label={t('card.field.name')}
              value={provider.name}
              disabled={disabled}
              onEdit={(v) => onPatchProvider(index, { name: v })}
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
                onChange={(event) => onPatchProvider(index, { protocol: event.target.value })}
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
              onEdit={(v) => onPatchProvider(index, { model: v })}
            />
          </div>
          <TextField
            prefix="imsc"
            id={`imsc-purl-${index}`}
            label={t('card.field.baseUrl')}
            value={provider.baseUrl}
            disabled={disabled}
            onEdit={(v) => onPatchProvider(index, { baseUrl: v })}
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
              onChange={(event) => onPatchProvider(index, { extraHeadersText: event.target.value })}
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
          onPatch({
            providers: [
              ...draft.providers,
              emptyProviderDraft(protocols[0]?.id ?? 'openai-images'),
            ],
          })
        }
      >
        {t('card.add')} · {t('card.providers')}
      </button>
    </>
  )
}

export function PromptPresetSection(props: PresetSectionsProps): ReactElement {
  const { t, draft, disabled, onPatch, onPatchPrompt } = props
  return (
    <>
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
              onChange={(event) => onPatchPrompt(index, { name: event.target.value })}
            />
            <button
              type="button"
              className="imsc-btn imsc-btnGhost"
              disabled={disabled}
              onClick={() => onPatch({ prompts: draft.prompts.filter((_, i) => i !== index) })}
            >
              {t('common.delete')}
            </button>
          </div>
          <textarea
            className="imsc-textarea"
            aria-label={t('card.field.text')}
            value={prompt.text}
            disabled={disabled}
            onChange={(event) => onPatchPrompt(index, { text: event.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="imsc-btn imsc-btnGhost"
        disabled={disabled}
        onClick={() => onPatch({ prompts: [...draft.prompts, emptyPromptDraft()] })}
      >
        {t('card.add')} · {t('card.prompts')}
      </button>
    </>
  )
}

export function ParamPresetSection(props: PresetSectionsProps): ReactElement {
  const { t, draft, disabled, onPatch, onPatchParam } = props
  return (
    <>
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
              onChange={(event) => onPatchParam(index, { name: event.target.value })}
            />
            <select
              className="imsc-select"
              aria-label={t('card.field.endpoint')}
              value={param.endpoint}
              disabled={disabled}
              onChange={(event) => onPatchParam(index, { endpoint: event.target.value })}
            >
              <option value="generation">{t('tab.generation')}</option>
              <option value="edit">{t('tab.edit')}</option>
            </select>
            <button
              type="button"
              className="imsc-btn imsc-btnGhost"
              disabled={disabled}
              onClick={() => onPatch({ params: draft.params.filter((_, i) => i !== index) })}
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
            onChange={(event) => onPatchParam(index, { specsText: event.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="imsc-btn imsc-btnGhost"
        disabled={disabled}
        onClick={() => onPatch({ params: [...draft.params, emptyParamDraft()] })}
      >
        {t('card.add')} · {t('card.params')}
      </button>
    </>
  )
}
