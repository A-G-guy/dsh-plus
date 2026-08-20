/**
 * compat 覆盖编辑器：按当前 api 渲染字段组（与服务端 compat.ts 字段表一致）。
 * boolean → 三态下拉（未设置/true/false），枚举 → 下拉（含未设置），
 * object → JSON 文本框（本地文本状态，合法时写入草稿，非法仅提示）。
 * 未知/非法值由后端校验兜底（PUT 失败会返回校验明细）。
 * @module llm-pi/client/views/compat
 */
import type { ReactElement } from 'react'

import { COMPAT_FALLBACK_API, compatFieldSpec, compatFieldsOf } from '../constants.ts'
import { CollapseSection, JsonField, SelectField } from '../fields.tsx'

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

export interface CompatEditorProps {
  idPrefix: string
  api: string
  compat: Record<string, unknown>
  epoch: number
  disabled?: boolean
  wide?: boolean
  t(key: string): string
  onEdit(next: Record<string, unknown>): void
}

export function CompatEditor(props: CompatEditorProps): ReactElement {
  const effective =
    props.api !== '' && compatFieldsOf(props.api).length > 0 ? props.api : COMPAT_FALLBACK_API
  const fields = compatFieldsOf(effective)
  const setField = (field: string, value: unknown): void => {
    const next = { ...props.compat }
    if (value === undefined) delete next[field]
    else next[field] = value
    props.onEdit(next)
  }
  return (
    <div className={`lpc-field lpc-wide`}>
      <CollapseSection
        id={`${props.idPrefix}-collapse`}
        title={props.t('compatGroup')}
        defaultOpen={false}
      >
        {props.api === '' ? <p className="lpc-hint">{props.t('compatApiHint')}</p> : null}
        <div className="lpc-grid">
          {fields.map((field) => {
            const spec = compatFieldSpec(effective, field)
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
