/**
 * 配置卡片的基础控件：文本/数字/密码字段与勾选行。
 * 视觉对齐官方卡片字段（label + hint + input 纵列）。
 * @module notify-email/client/fields
 */
import type { ReactElement } from 'react'

export interface TextFieldProps {
  id: string
  label: string
  hint?: string
  value: string
  disabled?: boolean
  invalid?: boolean
  invalidLabel?: string
  numeric?: boolean
  password?: boolean
  badge?: { text: string; set: boolean }
  onEdit(text: string): void
}

export function TextField(props: TextFieldProps): ReactElement {
  const invalid = props.invalid === true
  return (
    <div className="dne-field">
      <div className="dne-head">
        <label className="dne-label" htmlFor={props.id}>
          {props.label}
        </label>
        {props.badge !== undefined ? (
          <span className={`dne-badge ${props.badge.set ? 'dne-badgeSet' : 'dne-badgeUnset'}`}>
            {props.badge.text}
          </span>
        ) : null}
      </div>
      <input
        id={props.id}
        className={`dne-input${invalid ? ' dne-inputInvalid' : ''}`}
        type={props.password === true ? 'password' : 'text'}
        inputMode={props.numeric === true ? 'numeric' : undefined}
        autoComplete={props.password === true ? 'off' : undefined}
        aria-invalid={invalid || undefined}
        value={props.value}
        disabled={props.disabled === true}
        onChange={(event) => props.onEdit(event.target.value)}
      />
      <p className={invalid ? 'dne-invalid' : 'dne-hint'}>
        {invalid ? (props.invalidLabel ?? '') : (props.hint ?? '')}
      </p>
    </div>
  )
}

export interface CheckRowProps {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onEdit(checked: boolean): void
}

export function CheckRow(props: CheckRowProps): ReactElement {
  return (
    <div className="dne-checkRow">
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
