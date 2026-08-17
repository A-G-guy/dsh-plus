/**
 * 配置卡片的基础控件：勾选行与下拉选择行（视觉对齐官方卡片字段）。
 * @module subagent-model/client/fields
 */
import type { ReactElement } from 'react'

export interface CheckRowProps {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onEdit(checked: boolean): void
}

export function CheckRow(props: CheckRowProps): ReactElement {
  return (
    <div className="dsm-checkRow">
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled === true}
        onChange={(event) => props.onEdit(event.target.checked)}
      />
      <label htmlFor={props.id}>{props.label}</label>
    </div>
  )
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectFieldProps {
  id: string
  label: string
  hint?: string
  value: string
  options: SelectOption[]
  disabled?: boolean
  invalid?: boolean
  invalidLabel?: string
  onEdit(value: string): void
}

export function SelectField(props: SelectFieldProps): ReactElement {
  const invalid = props.invalid === true
  return (
    <div className="dsm-field">
      <div className="dsm-head">
        <label className="dsm-label" htmlFor={props.id}>
          {props.label}
        </label>
      </div>
      <select
        id={props.id}
        className="dsm-select"
        aria-invalid={invalid || undefined}
        value={props.value}
        disabled={props.disabled === true}
        onChange={(event) => props.onEdit(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className={invalid ? 'dsm-invalid' : 'dsm-hint'}>
        {invalid ? (props.invalidLabel ?? '') : (props.hint ?? '')}
      </p>
    </div>
  )
}
