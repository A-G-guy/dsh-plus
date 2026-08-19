/**
 * Provider route 的标量字段组：基础字段网格（继承/显示名/端点/凭据/默认容量/
 * 超时/默认模态/预算）与协议/档位/缓存/传输下拉组。compat、headers、
 * retryPolicy 与模型目录在 views/providers.tsx 的 route 小节内另行渲染。
 * @module llm-pi/client/views/provider-fields
 */
import type { ReactElement } from 'react'

import {
  BUDGET_KEYS, CACHE_RETENTION_OPTIONS, MODALITIES, PROTOCOL_IDS, THINKING_LEVELS, TRANSPORT_OPTIONS,
} from '../constants.ts'
import type { ProviderDraft } from '../draft.ts'
import { CheckRow, SelectField, TextField } from '../fields.tsx'
import { pruneCompatForApi } from './compat.tsx'

export interface ProviderScalarFieldsProps {
  id: string
  draft: ProviderDraft
  disabled?: boolean
  t(key: string): string
  onPatch(patch: Partial<ProviderDraft>): void
}

export function ProviderScalarFields(props: ProviderScalarFieldsProps): ReactElement {
  const { draft, t } = props
  return (
    <div className="lpc-grid">
      <TextField
        id={`${props.id}-extends`}
        label={t('extends')}
        hint={t('extendsHint')}
        value={draft.extends}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ extends: value })}
      />
      <TextField
        id={`${props.id}-displayName`}
        label={t('displayName')}
        value={draft.displayName}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ displayName: value })}
      />
      <TextField
        id={`${props.id}-baseURL`}
        label={t('baseURL')}
        hint={t('baseURLHint')}
        value={draft.baseURL}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ baseURL: value })}
      />
      <TextField
        id={`${props.id}-apiKeyEnv`}
        label={t('apiKeyEnv')}
        hint={t('apiKeyEnvHint')}
        value={draft.apiKeyEnv}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ apiKeyEnv: value })}
      />
      <TextField
        id={`${props.id}-defaultCtx`}
        label={t('defaultContextWindow')}
        numeric
        value={draft.defaultContextWindow}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ defaultContextWindow: value })}
      />
      <TextField
        id={`${props.id}-defaultMax`}
        label={t('defaultMaxTokens')}
        numeric
        value={draft.defaultMaxTokens}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ defaultMaxTokens: value })}
      />
      <TextField
        id={`${props.id}-timeout`}
        label={t('timeoutMs')}
        numeric
        value={draft.timeoutMs}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ timeoutMs: value })}
      />
      <TextField
        id={`${props.id}-wsTimeout`}
        label={t('websocketConnectTimeoutMs')}
        numeric
        value={draft.websocketConnectTimeoutMs}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ websocketConnectTimeoutMs: value })}
      />
      <TextField
        id={`${props.id}-streamIdle`}
        label={t('streamIdleTimeoutMs')}
        numeric
        value={draft.streamIdleTimeoutMs}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ streamIdleTimeoutMs: value })}
      />
      <TextField
        id={`${props.id}-maxImageBytes`}
        label={t('maxRequestImageBytes')}
        numeric
        value={draft.maxRequestImageBytes}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ maxRequestImageBytes: value })}
      />
      <div className="lpc-field">
        <span className="lpc-label">{t('defaultInput')}</span>
        {MODALITIES.map((modality) => (
          <CheckRow
            key={modality}
            id={`${props.id}-input-${modality}`}
            label={modality}
            checked={draft.input[modality]}
            disabled={props.disabled === true}
            onEdit={(checked) => props.onPatch({ input: { ...draft.input, [modality]: checked } })}
          />
        ))}
      </div>
      <div className="lpc-field">
        <span className="lpc-label">{t('thinkingBudgets')}</span>
        <div className="lpc-grid lpc-gridNested">
          {BUDGET_KEYS.map((key) => (
            <TextField
              key={key}
              id={`${props.id}-budget-${key}`}
              label={key}
              numeric
              value={draft.thinkingBudgets[key]}
              disabled={props.disabled === true}
              onEdit={(value) =>
                props.onPatch({ thinkingBudgets: { ...draft.thinkingBudgets, [key]: value } })
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** 协议/档位/缓存/传输四个下拉组。 */
export function ProviderSelectFields(props: ProviderScalarFieldsProps): ReactElement {
  const { draft, t } = props
  return (
    <div className="lpc-grid">
      <SelectField
        id={`${props.id}-api`}
        label={t('api')}
        value={draft.api}
        options={PROTOCOL_IDS}
        unsetLabel={t('compatUnset')}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ api: value, compat: pruneCompatForApi(draft.compat, value) })}
      />
      <SelectField
        id={`${props.id}-reasoning`}
        label={t('reasoning')}
        value={draft.reasoning}
        options={THINKING_LEVELS}
        unsetLabel={t('compatUnset')}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ reasoning: value })}
      />
      <SelectField
        id={`${props.id}-cache`}
        label={t('cacheRetention')}
        value={draft.cacheRetention}
        options={CACHE_RETENTION_OPTIONS}
        unsetLabel={t('compatUnset')}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ cacheRetention: value })}
      />
      <SelectField
        id={`${props.id}-transport`}
        label={t('transport')}
        value={draft.transport}
        options={TRANSPORT_OPTIONS}
        unsetLabel={t('compatUnset')}
        disabled={props.disabled === true}
        onEdit={(value) => props.onPatch({ transport: value })}
      />
    </div>
  )
}
