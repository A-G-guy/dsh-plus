/**
 * 配置卡片基础控件：文本/数字输入、勾选行、下拉、键值对编辑、JSON 文本框。
 * 视觉对齐官方卡片字段（label + hint + 控件纵列），样式类前缀 lpc-。
 * @module llm-pi/client/fields
 */
import { type ReactElement, useEffect, useState } from 'react'

import type { HeaderPair } from './draft.ts'

/**
 * 可折叠小节：复杂项（compat/retryPolicy 等）默认折叠，避免卡片过长；
 * 基础项（baseURL 等）保持展开。标题按钮切换展开态。
 */
export interface CollapseSectionProps {
  id: string
  title: string
  /** 默认展开态；复杂项传 false（默认折叠）。 */
  defaultOpen: boolean
  disabled?: boolean
  children: ReactElement | ReactElement[] | null
}

export function CollapseSection(props: CollapseSectionProps): ReactElement {
  const [open, setOpen] = useState(props.defaultOpen)
  return (
    <div className="lpc-collapse">
      <button
        type="button"
        className="lpc-collapseHead"
        id={props.id}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`lpc-chevron${open ? ' lpc-chevronOpen' : ''}`}>▾</span>
        <span className="lpc-collapseTitle">{props.title}</span>
      </button>
      {open ? <div className="lpc-collapseBody">{props.children}</div> : null}
    </div>
  )
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
  /** datalist 的 id（extends 候选）。 */
  list?: string
  wide?: boolean
  onEdit(text: string): void
}

export function TextField(props: TextFieldProps): ReactElement {
  const invalid = props.invalid === true
  return (
    <div className={`lpc-field${props.wide === true ? ' lpc-wide' : ''}`}>
      <div className="lpc-head">
        <label className="lpc-label" htmlFor={props.id}>
          {props.label}
        </label>
      </div>
      <input
        id={props.id}
        className={`lpc-input${invalid ? ' lpc-inputInvalid' : ''}`}
        type="text"
        inputMode={props.numeric === true ? 'numeric' : undefined}
        list={props.list}
        aria-invalid={invalid || undefined}
        value={props.value}
        disabled={props.disabled === true}
        onChange={(event) => props.onEdit(event.target.value)}
      />
      <p className={invalid ? 'lpc-invalid' : 'lpc-hint'}>
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
    <div className="lpc-checkRow">
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
  value: string
  options: readonly string[]
  /** 是否渲染"未设置"（value=''）项，及其中文文案。 */
  unsetLabel?: string
  disabled?: boolean
  wide?: boolean
  onEdit(value: string): void
}

export function SelectField(props: SelectFieldProps): ReactElement {
  return (
    <div className={`lpc-field${props.wide === true ? ' lpc-wide' : ''}`}>
      <div className="lpc-head">
        <label className="lpc-label" htmlFor={props.id}>
          {props.label}
        </label>
      </div>
      <select
        id={props.id}
        className="lpc-input lpc-select"
        value={props.value}
        disabled={props.disabled === true}
        onChange={(event) => props.onEdit(event.target.value)}
      >
        {props.unsetLabel !== undefined ? <option value="">{props.unsetLabel}</option> : null}
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

export interface KeyValueEditorProps {
  id: string
  label: string
  hint?: string
  pairs: HeaderPair[]
  disabled?: boolean
  keyPlaceholder: string
  valuePlaceholder: string
  addLabel: string
  removeLabel: string
  onEdit(pairs: HeaderPair[]): void
}

export function KeyValueEditor(props: KeyValueEditorProps): ReactElement {
  const update = (index: number, patch: Partial<HeaderPair>): void => {
    props.onEdit(props.pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)))
  }
  const remove = (index: number): void => {
    props.onEdit(props.pairs.filter((_, i) => i !== index))
  }
  return (
    <div className="lpc-field lpc-wide">
      <div className="lpc-head">
        <label className="lpc-label" htmlFor={props.id}>
          {props.label}
        </label>
      </div>
      {props.pairs.map((pair, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 可编辑 KV 行无稳定 id，行序即身份（增删行经 onEdit 整体回写）
        <div className="lpc-kvRow" key={index}>
          <input
            id={index === 0 ? props.id : undefined}
            className="lpc-input"
            value={pair.key}
            placeholder={props.keyPlaceholder}
            disabled={props.disabled === true}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <input
            className="lpc-input"
            value={pair.value}
            placeholder={props.valuePlaceholder}
            disabled={props.disabled === true}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <button
            type="button"
            className="lpc-btn lpc-btnGhost lpc-btnSmall"
            disabled={props.disabled === true}
            onClick={() => remove(index)}
          >
            {props.removeLabel}
          </button>
        </div>
      ))}
      <div className="lpc-kvAdd">
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled === true}
          onClick={() => props.onEdit([...props.pairs, { key: '', value: '' }])}
        >
          {props.addLabel}
        </button>
      </div>
      {props.hint !== undefined ? <p className="lpc-hint">{props.hint}</p> : null}
    </div>
  )
}

function toJsonText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === '') return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

export interface JsonFieldProps {
  id: string
  label: string
  hint?: string
  invalidText: string
  value: unknown
  /** 放弃/保存后外部重置草稿时自增，驱动本地文本重新播种。 */
  epoch: number
  disabled?: boolean
  wide?: boolean
  onEdit(value: unknown): void
}

export function JsonField(props: JsonFieldProps): ReactElement {
  const [text, setText] = useState(() => toJsonText(props.value))
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在 epoch 递增（外部重置语义）时同步文本，避免编辑中被 value 回写打断
  useEffect(() => {
    setText(toJsonText(props.value))
  }, [props.epoch])
  const parsed = parseJsonText(text)
  return (
    <div className={`lpc-field${props.wide === true ? ' lpc-wide' : ''}`}>
      <div className="lpc-head">
        <label className="lpc-label" htmlFor={props.id}>
          {props.label}
        </label>
      </div>
      <textarea
        id={props.id}
        className={`lpc-input lpc-textarea${parsed.ok ? '' : ' lpc-inputInvalid'}`}
        rows={4}
        spellCheck={false}
        aria-invalid={parsed.ok ? undefined : true}
        value={text}
        disabled={props.disabled === true}
        onChange={(event) => {
          setText(event.target.value)
          const result = parseJsonText(event.target.value)
          props.onEdit(result.ok ? result.value : undefined)
        }}
      />
      <p className={parsed.ok ? 'lpc-hint' : 'lpc-invalid'}>
        {parsed.ok ? (props.hint ?? '') : props.invalidText}
      </p>
    </div>
  )
}
