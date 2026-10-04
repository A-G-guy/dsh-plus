/**
 * compat 覆盖编辑器：按当前 api 渲染字段组（与服务端 compat.ts 字段表一致）。
 * boolean → 三态下拉（未设置/true/false），枚举 → 下拉（含未设置），
 * object → JSON 文本框（本地文本状态，合法时写入草稿，非法仅提示）。
 * 未知/非法值由后端校验兜底（保存失败会返回校验明细）。
 * 字段多（如 completions 19 项）时提供字段名过滤，折叠标题显示"已设 M/K"。
 * @module llm-pi/client/views/compat
 */
import type { ReactElement } from 'react'
import { useState } from 'react'

import { COMPAT_FALLBACK_API, compatFieldSpec, compatFieldsOf } from '../constants.ts'
import { CollapseSection, IntegerField, JsonField, SelectField } from '../fields.tsx'
import type { Translate } from '../i18n.ts'

/** api 变更后裁剪 compat：只保留新渲染组的字段，避免保存时被后端拒绝。 */
export function pruneCompatForApi(
  compat: Record<string, unknown>,
  api: string,
): Record<string, unknown> {
  const group = api !== '' && compatFieldsOf(api).length > 0 ? api : COMPAT_FALLBACK_API
  const fields = new Set(compatFieldsOf(group))
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(compat)) {
    if (fields.has(key)) next[key] = value
  }
  return next
}

/** 字段数超过该值时提供过滤框（19 项一屏放不下）。 */
const FILTER_THRESHOLD = 10

export interface CompatEditorProps {
  idPrefix: string
  api: string
  compat: Record<string, unknown>
  epoch: number
  disabled?: boolean
  wide?: boolean
  t: Translate
  onEdit(next: Record<string, unknown>): void
}

export function CompatEditor(props: CompatEditorProps): ReactElement {
  const [filter, setFilter] = useState('')
  const effective =
    props.api !== '' && compatFieldsOf(props.api).length > 0 ? props.api : COMPAT_FALLBACK_API
  const allFields = compatFieldsOf(effective)
  const needle = filter.trim().toLowerCase()
  const fields =
    needle === '' ? allFields : allFields.filter((f) => f.toLowerCase().includes(needle))
  const setCount = allFields.filter((field) => props.compat[field] !== undefined).length
  const setField = (field: string, value: unknown): void => {
    const next = { ...props.compat }
    if (value === undefined) delete next[field]
    else next[field] = value
    props.onEdit(next)
  }
  return (
    <div className={'lpc-field lpc-wide'}>
      <CollapseSection
        id={`${props.idPrefix}-collapse`}
        title={props.t('compatGroup')}
        meta={
          allFields.length === 0
            ? ''
            : `${props.t('compatSetCount')} ${setCount}/${allFields.length}`
        }
        defaultOpen={false}
      >
        {props.api === '' ? <p className="lpc-hint">{props.t('compatApiHint')}</p> : null}
        {allFields.length > FILTER_THRESHOLD ? (
          <div className="lpc-catBar">
            <input
              className="lpc-input lpc-catSearch"
              type="search"
              value={filter}
              placeholder={props.t('compatFilter')}
              aria-label={props.t('compatFilter')}
              disabled={props.disabled === true}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        ) : null}
        <div className="lpc-grid">
          {fields.map((field) => {
            const spec = compatFieldSpec(effective, field)
            // 键取自同一张表（compatFieldsOf），spec 不可能为 undefined；此处仅收窄类型
            if (spec === undefined) return null
            if (spec === 'boolean') {
              return (
                <SelectField
                  key={field}
                  id={`${props.idPrefix}-${field}`}
                  label={field}
                  value={props.compat[field] === undefined ? '' : String(props.compat[field])}
                  options={['true', 'false']}
                  unsetLabel={props.t('compatUnset')}
                  disabled={props.disabled === true}
                  onEdit={(value) => {
                    if (value === '') setField(field, undefined)
                    else setField(field, value === 'true')
                  }}
                />
              )
            }
            if (spec === 'object') {
              return (
                <JsonField
                  key={field}
                  id={`${props.idPrefix}-${field}`}
                  label={field}
                  value={props.compat[field]}
                  epoch={props.epoch}
                  disabled={props.disabled === true}
                  invalidText={props.t('invalidJson')}
                  onEdit={(value) => setField(field, value)}
                />
              )
            }
            if (spec === 'integer' || spec === 'number') {
              return (
                <IntegerField
                  key={field}
                  id={`${props.idPrefix}-${field}`}
                  label={field}
                  value={props.compat[field]}
                  epoch={props.epoch}
                  invalidLabel={props.t('invalidInteger')}
                  disabled={props.disabled === true}
                  onEdit={(value) => setField(field, value)}
                />
              )
            }
            // 余下只有枚举（readonly string[]）：boolean/object/number 已在上方分支消化
            return (
              <SelectField
                key={field}
                id={`${props.idPrefix}-${field}`}
                label={field}
                value={props.compat[field] === undefined ? '' : String(props.compat[field])}
                options={spec}
                unsetLabel={props.t('compatUnset')}
                disabled={props.disabled === true}
                onEdit={(value) => {
                  if (value === '') setField(field, undefined)
                  else setField(field, value)
                }}
              />
            )
          })}
        </div>
      </CollapseSection>
    </div>
  )
}
