/**
 * 模型目录编辑：每行一个模型（id/extends/name/容量/模态/reasoningEfforts/compat），
 * extends 输入框带 datalist 候选——候选来自 /catalog 端点：选定 source
 * （builtin / models-dev）与 provider 后拉取其 models 列表。
 * @module llm-pi/client/views/models
 */
import { type ReactElement, useEffect, useState } from 'react'

import { fetchCatalog, type WireModelsDevStatus } from '../api.ts'
import { MODALITIES, THINKING_LEVELS } from '../constants.ts'
import { emptyModelDraft, type ModelDraft, type ReasoningDraft } from '../draft.ts'
import { CheckRow, TextField } from '../fields.tsx'
import { CompatEditor } from './compat.tsx'

type CatalogSource = 'builtin' | 'models-dev'

function catalogNote(status: WireModelsDevStatus | undefined, t: (key: string) => string): string {
  if (status === undefined) return ''
  if (status.error !== null) return `${t('modelsDevError')}${status.error}`
  return `${t('modelsDevStatusLine')}：${status.providers} 个 provider，快照 ${status.fetchedAt ?? '-'}`
}

export interface ModelsTableProps {
  route: string
  api: string
  /** 默认候选 provider（route 级 extends）。 */
  defaultProvider: string
  models: ModelDraft[]
  epoch: number
  disabled?: boolean
  t(key: string): string
  onModels(next: ModelDraft[]): void
}

export function ModelsTable(props: ModelsTableProps): ReactElement {
  const { t } = props
  const [source, setSource] = useState<CatalogSource>('builtin')
  const [providerIds, setProviderIds] = useState<string[]>([])
  const [provider, setProvider] = useState('')
  const [candidateModels, setCandidateModels] = useState<string[]>([])
  const [note, setNote] = useState('')
  const listId = `lpc-models-${props.route.replace(/[^a-zA-Z0-9_-]/g, '_')}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: 目录拉取仅随 source 切换重跑；t/defaultProvider 取首帧值即可
  useEffect(() => {
    let alive = true
    setNote(t('catalogLoading'))
    void (async () => {
      try {
        const list = await fetchCatalog('', source)
        if (!alive) return
        setProviderIds(list.providers)
        const preferred = list.providers.includes(props.defaultProvider)
          ? props.defaultProvider
          : (list.providers[0] ?? '')
        setProvider(preferred)
        setNote(catalogNote(list.status, t))
        if (preferred === '') return
        const result = await fetchCatalog(preferred, source)
        if (alive) setCandidateModels(result.models)
      } catch {
        if (alive) setNote(t('catalogFailed'))
      }
    })()
    return () => {
      alive = false
    }
  }, [source])

  const onProviderChange = (value: string): void => {
    setProvider(value)
    if (value === '') {
      setCandidateModels([])
      return
    }
    void fetchCatalog(value, source)
      .then((result) => setCandidateModels(result.models))
      .catch(() => setNote(t('catalogFailed')))
  }

  return (
    <div className="lpc-models">
      <div className="lpc-modelHead">
        <span className="lpc-modelTitle">{t('modelsGroup')}</span>
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled === true}
          onClick={() => props.onModels([...props.models, emptyModelDraft()])}
        >
          {t('addModel')}
        </button>
      </div>
      <div className="lpc-catalogBar">
        <label className="lpc-catalogLabel" htmlFor={`${listId}-source`}>
          {t('catalogSource')}
        </label>
        <select
          id={`${listId}-source`}
          className="lpc-input lpc-select lpc-catalogSelect"
          value={source}
          disabled={props.disabled === true}
          onChange={(event) => setSource(event.target.value as CatalogSource)}
        >
          <option value="builtin">builtin</option>
          <option value="models-dev">models-dev</option>
        </select>
        <label className="lpc-catalogLabel" htmlFor={`${listId}-provider`}>
          {t('catalogProvider')}
        </label>
        <select
          id={`${listId}-provider`}
          className="lpc-input lpc-select lpc-catalogSelect"
          value={provider}
          disabled={props.disabled === true || providerIds.length === 0}
          onChange={(event) => onProviderChange(event.target.value)}
        >
          <option value="">-</option>
          {providerIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>
      {note !== '' ? <p className="lpc-hint">{note}</p> : null}
      <datalist id={listId}>
        {candidateModels.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {props.models.map((model, index) => (
        <ModelRow
          // biome-ignore lint/suspicious/noArrayIndexKey: model.id 可重复（手填），index 前缀保证 key 唯一且随行序稳定
          key={`${index}:${model.id}`}
          index={index}
          model={model}
          api={props.api}
          listId={listId}
          epoch={props.epoch}
          disabled={props.disabled === true}
          t={t}
          onPatch={(patch) =>
            props.onModels(props.models.map((m, i) => (i === index ? { ...m, ...patch } : m)))
          }
          onRemove={() => props.onModels(props.models.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  )
}

export interface ModelRowProps {
  index: number
  model: ModelDraft
  api: string
  listId: string
  epoch: number
  disabled?: boolean
  t(key: string): string
  onPatch(patch: Partial<ModelDraft>): void
  onRemove(): void
}

export function ModelRow(props: ModelRowProps): ReactElement {
  const { model, t } = props
  const id = `${props.listId}-m${props.index}`
  return (
    <div className="lpc-modelRow">
      <div className="lpc-modelHead">
        <span className="lpc-modelTitle">
          {t('modelRow')} {props.index + 1}
        </span>
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled === true}
          onClick={props.onRemove}
        >
          {t('deleteModel')}
        </button>
      </div>
      <div className="lpc-grid">
        <TextField
          id={`${id}-id`}
          label={t('modelId')}
          hint={t('modelIdHint')}
          value={model.id}
          disabled={props.disabled === true}
          invalid={model.id.trim() === ''}
          invalidLabel={t('modelIdRequired')}
          onEdit={(value) => props.onPatch({ id: value })}
        />
        <TextField
          id={`${id}-extends`}
          label={t('modelExtends')}
          hint={t('modelExtendsHint')}
          value={model.extends}
          list={props.listId}
          disabled={props.disabled === true}
          onEdit={(value) => props.onPatch({ extends: value })}
        />
        <TextField
          id={`${id}-name`}
          label={t('modelName')}
          value={model.name}
          disabled={props.disabled === true}
          onEdit={(value) => props.onPatch({ name: value })}
        />
        <TextField
          id={`${id}-ctx`}
          label={t('contextWindow')}
          numeric
          value={model.contextWindow}
          disabled={props.disabled === true}
          onEdit={(value) => props.onPatch({ contextWindow: value })}
        />
        <TextField
          id={`${id}-max`}
          label={t('maxTokens')}
          numeric
          value={model.maxTokens}
          disabled={props.disabled === true}
          onEdit={(value) => props.onPatch({ maxTokens: value })}
        />
        <div className="lpc-field">
          <span className="lpc-label">{t('input')}</span>
          {MODALITIES.map((modality) => (
            <CheckRow
              key={modality}
              id={`${id}-input-${modality}`}
              label={modality}
              checked={model.input[modality]}
              disabled={props.disabled === true}
              onEdit={(checked) =>
                props.onPatch({
                  input: { ...model.input, [modality]: checked },
                })
              }
            />
          ))}
        </div>
      </div>
      <ReasoningEditor
        idPrefix={`${id}-re`}
        value={model.reasoningEfforts}
        disabled={props.disabled === true}
        t={t}
        onEdit={(reasoningEfforts) => props.onPatch({ reasoningEfforts })}
      />
      <CompatEditor
        idPrefix={`${id}-compat`}
        api={props.api}
        compat={model.compat}
        epoch={props.epoch}
        disabled={props.disabled === true}
        wide
        t={t}
        onEdit={(compat) => props.onPatch({ compat })}
      />
    </div>
  )
}

export interface ReasoningEditorProps {
  idPrefix: string
  value: ReasoningDraft
  disabled?: boolean
  t(key: string): string
  onEdit(next: ReasoningDraft): void
}

export function ReasoningEditor(props: ReasoningEditorProps): ReactElement {
  const { value } = props
  return (
    <div className="lpc-field lpc-wide">
      <div className="lpc-head">
        <span className="lpc-label">{props.t('reasoningEfforts')}</span>
      </div>
      <div className="lpc-checkRow">
        <input
          id={`${props.idPrefix}-nonreasoning`}
          type="checkbox"
          checked={value.nonReasoning}
          disabled={props.disabled === true}
          onChange={(event) => props.onEdit({ ...value, nonReasoning: event.target.checked })}
        />
        <label htmlFor={`${props.idPrefix}-nonreasoning`}>{props.t('nonReasoning')}</label>
      </div>
      {value.nonReasoning ? null : (
        <div className="lpc-grid">
          {THINKING_LEVELS.map((level) => (
            <TextField
              key={level}
              id={`${props.idPrefix}-${level}`}
              label={level}
              value={value.levels[level] ?? ''}
              disabled={props.disabled === true}
              onEdit={(text) =>
                props.onEdit({
                  ...value,
                  levels: { ...value.levels, [level]: text },
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
