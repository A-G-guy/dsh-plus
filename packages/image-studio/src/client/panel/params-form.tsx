/**
 * 参数表单：按参数目录动态渲染（kind → 控件形态，advanced 折叠）。
 * - boolean 参数的开关即取值（启用 = true）；
 * - 其余参数：开关 + 值控件（enum 下拉 / integer 数字框 / string 文本框）；
 * - 声明了结构化规则的参数（size）追加预设快捷项与即时校验提示，自由输入不受限；
 * - 每项附中文说明与代际标记（GPT Image / dall-e-3 / dall-e-2）。
 * @module image-studio/client/panel/params-form
 */
import type { ReactElement } from 'react'
import type { ParamEntry } from '../../params/catalog.ts'
import { checkImageSize, SIZE_PRESETS } from '../../params/size.ts'
import type { ImageEndpoint } from '../../provider/types.ts'
import type { Translate } from '../i18n.ts'
import { type ParamFormState, paramEntriesFor } from './param-state.ts'

interface ParamsFormProps {
  t: Translate
  catalog: readonly ParamEntry[]
  endpoint: ImageEndpoint
  form: ParamFormState
  onChange(next: ParamFormState): void
}

/** 结构化规则的即时提示：规则通过或取值未填时不占位。 */
function ruleHint(entry: ParamEntry, value: string): string | null {
  if (entry.rules !== 'image-size' || value.trim() === '') return null
  const checked = checkImageSize(value)
  return checked.ok ? null : checked.message
}

/** 单参数行：开关 + 名称/说明 + 值控件（+ 预设与校验提示）。 */
function ParamRow(props: {
  t: Translate
  entry: ParamEntry
  form: ParamFormState
  onChange(next: ParamFormState): void
}): ReactElement {
  const { t, entry, form, onChange } = props
  const field = form[entry.key] ?? { enabled: false, value: '' }
  const patch = (next: Partial<typeof field>): void =>
    onChange({ ...form, [entry.key]: { ...field, ...next } })
  const text = String(field.value)
  const hint = field.enabled ? ruleHint(entry, text) : null
  /** size 预设：快捷填写，仍可自由改动输入框。 */
  const presets = entry.rules === 'image-size' ? SIZE_PRESETS : []

  const control = (() => {
    if (entry.kind === 'boolean') return null
    if (entry.kind === 'enum') {
      return (
        <select
          className="ims-input ims-paramControl"
          value={text}
          disabled={!field.enabled}
          onChange={(event) => patch({ value: event.target.value })}
        >
          {(entry.values ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      )
    }
    if (entry.kind === 'integer') {
      return (
        <input
          className="ims-input ims-paramControl"
          type="number"
          inputMode="numeric"
          min={entry.min}
          max={entry.max}
          value={text}
          disabled={!field.enabled}
          onChange={(event) => patch({ value: event.target.value })}
        />
      )
    }
    return (
      <input
        className={`ims-input ims-paramControl${hint !== null ? ' ims-inputInvalid' : ''}`}
        type="text"
        list={presets.length > 0 ? `ims-size-options-${entry.key}` : undefined}
        value={text}
        disabled={!field.enabled}
        aria-invalid={hint !== null}
        onChange={(event) => patch({ value: event.target.value })}
      />
    )
  })()

  return (
    <div className={`ims-paramRow${field.enabled ? ' ims-paramRowOn' : ''}`}>
      <label className="ims-switch" title={t('params.enabled')}>
        <input
          type="checkbox"
          role="switch"
          aria-label={`${entry.key} ${t('params.enabled')}`}
          aria-checked={field.enabled}
          checked={field.enabled}
          onChange={(event) =>
            entry.kind === 'boolean'
              ? patch({ enabled: event.target.checked, value: event.target.checked })
              : patch({ enabled: event.target.checked })
          }
        />
        <span className="ims-switchTrack" aria-hidden="true" />
      </label>
      <div className="ims-paramText">
        <span className="ims-paramKey">
          {entry.key}
          {entry.generation !== 'current' ? (
            <span className="ims-paramGen">{entry.generation}</span>
          ) : null}
        </span>
        <span className="ims-paramDesc">{entry.description}</span>
        {hint !== null ? (
          <span className="ims-paramWarn" role="alert">
            {hint}
          </span>
        ) : null}
      </div>
      <div className="ims-paramValue">
        {control}
        {presets.length > 0 && field.enabled ? (
          <span className="ims-paramPresets">
            {presets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                title={preset.label}
                className={`ims-chip${preset.value === text ? ' ims-chipOn' : ''}`}
                onClick={() => patch({ value: preset.value })}
              >
                {preset.value}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {presets.length > 0 ? (
        <datalist id={`ims-size-options-${entry.key}`}>
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value} label={preset.label} />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}

export function ParamsForm(props: ParamsFormProps): ReactElement {
  const { t, catalog, endpoint, form, onChange } = props
  const entries = paramEntriesFor(catalog, endpoint)
  const basics = entries.filter((entry) => !entry.advanced)
  const advanced = entries.filter((entry) => entry.advanced)
  const advancedOn = advanced.filter((entry) => form[entry.key]?.enabled === true).length
  return (
    <div className="ims-params">
      <div className="ims-paramGroup">
        {basics.map((entry) => (
          <ParamRow key={entry.key} t={t} entry={entry} form={form} onChange={onChange} />
        ))}
      </div>
      {advanced.length > 0 ? (
        <details className="ims-adv">
          <summary className="ims-advSummary">
            {t('params.advanced')}
            {advancedOn > 0 ? <span className="ims-advCount">{advancedOn}</span> : null}
          </summary>
          <div className="ims-paramGroup">
            {advanced.map((entry) => (
              <ParamRow key={entry.key} t={t} entry={entry} form={form} onChange={onChange} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
