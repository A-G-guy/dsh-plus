/**
 * 模型目录编辑：每行一个模型（id/extends/name/容量/模态/reasoningEfforts/compat/
 * 其余字段），**行默认折叠**——route 内模型一多，展开态会把配置页拉得极长。
 * 工具条提供"全部展开/收起"与 id/继承源过滤；继承源候选不再内联 datalist，
 * 改由卡片顶部「内置模型目录」浏览器承担（搜索 + 一键添加）。
 * @module llm-pi/client/views/models
 */

import { CheckRow, ChevronDownIcon } from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'

import { MODALITIES, THINKING_LEVELS } from '../constants.ts'
import { emptyModelDraft, extraOfJson, type ModelDraft, type ReasoningDraft } from '../draft.ts'
import { JsonField, TextField } from '../fields.tsx'
import type { Translate } from '../i18n.ts'
import { CompatEditor } from './compat.tsx'

export interface ModelsTableProps {
  route: string
  api: string
  models: ModelDraft[]
  epoch: number
  disabled?: boolean
  t: Translate
  onModels(next: ModelDraft[]): void
  /** 打开卡片顶部「内置模型目录」并把本 route 设为添加目标。 */
  onAddFromCatalog(): void
}

/** 行标题摘要：继承源与显示名（空则回退 id）。 */
function rowSummary(model: ModelDraft): string {
  const parts: string[] = []
  if (model.extends.trim() !== '') parts.push(`extends ${model.extends.trim()}`)
  if (model.name.trim() !== '' && model.name.trim() !== model.id.trim()) {
    parts.push(model.name.trim())
  }
  return parts.join(' · ')
}

export function ModelsTable(props: ModelsTableProps): ReactElement {
  const { t } = props
  const [openRows, setOpenRows] = useState<Record<number, boolean>>({})
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const visible = props.models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) =>
      needle === ''
        ? true
        : model.id.toLowerCase().includes(needle) ||
          model.extends.toLowerCase().includes(needle) ||
          model.name.toLowerCase().includes(needle),
    )
  const hidden = props.models.length - visible.length
  const allOpen =
    props.models.length > 0 && props.models.every((_, index) => openRows[index] === true)

  const toggleAll = (): void => {
    if (allOpen) {
      setOpenRows({})
      return
    }
    setOpenRows(Object.fromEntries(props.models.map((_, index) => [index, true])))
  }

  return (
    <div className="lpc-models">
      <div className="lpc-modelHead">
        <span className="lpc-modelTitle">{`${t('modelsGroup')}（${props.models.length}）`}</span>
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled === true || props.models.length === 0}
          onClick={toggleAll}
        >
          {allOpen ? t('modelsCollapseAll') : t('modelsExpandAll')}
        </button>
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled === true}
          onClick={props.onAddFromCatalog}
        >
          {t('addFromCatalog')}
        </button>
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled === true}
          onClick={() => props.onModels([...props.models, emptyModelDraft()])}
        >
          {t('addModel')}
        </button>
      </div>
      {props.models.length > 6 ? (
        <div className="lpc-catBar">
          <input
            className="lpc-input lpc-catSearch"
            type="search"
            value={filter}
            placeholder={t('modelsFilterPlaceholder')}
            aria-label={t('modelsFilter')}
            disabled={props.disabled === true}
            onChange={(event) => setFilter(event.target.value)}
          />
          {hidden > 0 ? (
            <span className="lpc-catNote">{`${t('modelsHidden')} ${hidden}`}</span>
          ) : null}
        </div>
      ) : null}
      {visible.map(({ model, index }) => (
        <ModelRow
          key={`${index}:${model.id}`}
          index={index}
          model={model}
          api={props.api}
          uid={props.route.replace(/[^a-zA-Z0-9_-]/g, '_')}
          open={openRows[index] === true}
          epoch={props.epoch}
          disabled={props.disabled === true}
          t={t}
          onToggle={() => setOpenRows((prev) => ({ ...prev, [index]: prev[index] !== true }))}
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
  /** route 派生的 id 前缀（DOM id 唯一性）。 */
  uid: string
  open: boolean
  epoch: number
  disabled?: boolean
  t: Translate
  onToggle(): void
  onPatch(patch: Partial<ModelDraft>): void
  onRemove(): void
}

/** 单行：折叠头（序号/id/摘要） + 展开体（全部字段）。 */
export function ModelRow(props: ModelRowProps): ReactElement {
  const { model, t } = props
  const id = `lpc-m-${props.uid}-${props.index}`
  const summary = rowSummary(model)
  return (
    <div className="lpc-modelRow">
      <div className="lpc-modelHead">
        <button
          type="button"
          className="lpc-routeToggle"
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <ChevronDownIcon className={`lpc-chevron${props.open ? ' lpc-chevronOpen' : ''}`} />
          <span className="lpc-modelTitle">{`#${props.index + 1}`}</span>
          <span className={model.id.trim() === '' ? 'lpc-invalid' : 'lpc-routeKey'}>
            {model.id.trim() === '' ? t('modelUntitled') : model.id}
          </span>
          {summary !== '' ? <span className="lpc-routeApi">{summary}</span> : null}
        </button>
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled === true}
          onClick={props.onRemove}
        >
          {t('deleteModel')}
        </button>
      </div>
      {props.open ? (
        <div className="lpc-modelBody">
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
                  prefix="lpc"
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
          <JsonField
            id={`${id}-extra`}
            label={t('extraFields')}
            hint={t('extraFieldsHint')}
            invalidText={t('invalidJson')}
            value={Object.keys(model.extra).length === 0 ? undefined : model.extra}
            epoch={props.epoch}
            disabled={props.disabled === true}
            wide
            onEdit={(extra) => {
              const next = extraOfJson(extra)
              // 合法但非对象的 JSON（数组/标量）忽略这次编辑，不静默清空已配置字段。
              if (next !== undefined) props.onPatch({ extra: next })
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

export interface ReasoningEditorProps {
  idPrefix: string
  value: ReasoningDraft
  disabled?: boolean
  t: Translate
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
