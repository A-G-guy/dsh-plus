/**
 * 配置卡片的基础控件（各插件 client 的公共收编版）：文本/数字/密码/下拉字段
 * 与勾选行。视觉对齐官方卡片字段（label + hint + input 纵列）。
 * 类名前缀由 prefix 注入（如 'dne'），样式由 cardCss(prefix) 生成，DOM 结构
 * 与迁移前逐字一致，避免视觉回归。
 * @module @dsh-plus/shared/client/fields
 */
import type { ReactElement } from 'react'

/** 下拉选项（value + 展示文案）。 */
export interface SelectOption {
  value: string
  label: string
}

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

export function TextField(props: TextFieldProps & { prefix?: string }): ReactElement {
  const p = props.prefix ?? 'dshp'
  const invalid = props.invalid === true
  return (
    <div className={`${p}-field`}>
      <div className={`${p}-head`}>
        <label className={`${p}-label`} htmlFor={props.id}>
          {props.label}
        </label>
        {props.badge !== undefined ? (
          <span className={`${p}-badge ${props.badge.set ? `${p}-badgeSet` : `${p}-badgeUnset`}`}>
            {props.badge.text}
          </span>
        ) : null}
      </div>
      <input
        id={props.id}
        className={`${p}-input${invalid ? ` ${p}-inputInvalid` : ''}`}
        type={props.password === true ? 'password' : 'text'}
        inputMode={props.numeric === true ? 'numeric' : undefined}
        autoComplete={props.password === true ? 'off' : undefined}
        aria-invalid={invalid || undefined}
        value={props.value}
        disabled={props.disabled === true}
        onChange={(event) => props.onEdit(event.target.value)}
      />
      <p className={invalid ? `${p}-invalid` : `${p}-hint`}>
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

export function CheckRow(props: CheckRowProps & { prefix?: string }): ReactElement {
  const p = props.prefix ?? 'dshp'
  return (
    <div className={`${p}-checkRow`}>
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

export interface SelectFieldProps {
  id: string
  label: string
  hint?: string
  value: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  invalid?: boolean
  invalidLabel?: string
  onEdit(value: string): void
}

export function SelectField(props: SelectFieldProps & { prefix?: string }): ReactElement {
  const p = props.prefix ?? 'dshp'
  const invalid = props.invalid === true
  return (
    <div className={`${p}-field`}>
      <div className={`${p}-head`}>
        <label className={`${p}-label`} htmlFor={props.id}>
          {props.label}
        </label>
      </div>
      <select
        id={props.id}
        className={`${p}-select${invalid ? ` ${p}-inputInvalid` : ''}`}
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
      <p className={invalid ? `${p}-invalid` : `${p}-hint`}>
        {invalid ? (props.invalidLabel ?? '') : (props.hint ?? '')}
      </p>
    </div>
  )
}
