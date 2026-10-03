/**
 * 价目行编辑器：一行手工价目（provider/model + 四项单价）与删除按钮。
 * 从 price-card.tsx 拆出，避免单组件过长；标签与输入框保持原有紧凑网格
 * （`dup-mini` + `dup-in`），单价用 `inputMode="decimal"` 以便移动端输入小数。
 * @module usage-panel/client/price-rows
 */

import type { ReactElement } from 'react'

import type { Translate } from './i18n.ts'

/** 一行手工价目（与 settings 的 prices[] 条目同形）。 */
export interface PriceRow {
  provider: string
  model: string
  inputPerMtok: number
  outputPerMtok: number
  cacheReadPerMtok: number
  cacheWritePerMtok: number
}

export interface PriceRowEditorProps {
  price: PriceRow
  disabled: boolean
  t: Translate
  onEdit(patch: Partial<PriceRow>): void
  onRemove(): void
}

function num(text: string): number {
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/** 一个带标注的单价输入格。 */
function PriceCell(props: {
  label: string
  value: number
  disabled: boolean
  onEdit(text: string): void
}): ReactElement {
  return (
    <label className="dup-mini">
      <span>{props.label}</span>
      <input
        className="dup-input dup-in"
        inputMode="decimal"
        value={String(props.value)}
        disabled={props.disabled}
        onChange={(event) => props.onEdit(event.target.value)}
      />
    </label>
  )
}

export function PriceRowEditor(props: PriceRowEditorProps): ReactElement {
  const { price, t, disabled } = props
  return (
    <div className="dup-priceRow">
      <div className="dup-priceHead">
        <span className="dup-priceTitle">
          {price.provider}/{price.model}
        </span>
        <button
          type="button"
          className="dup-btn dup-btnGhost dup-btnSmall"
          disabled={disabled}
          onClick={props.onRemove}
        >
          {t('removePrice')}
        </button>
      </div>
      <div className="dup-priceGrid">
        <label className="dup-mini">
          <span>{t('provider')}</span>
          <input
            className="dup-input dup-in"
            value={price.provider}
            disabled={disabled}
            onChange={(event) => props.onEdit({ provider: event.target.value })}
          />
        </label>
        <label className="dup-mini">
          <span>{t('model')}</span>
          <input
            className="dup-input dup-in"
            value={price.model}
            disabled={disabled}
            onChange={(event) => props.onEdit({ model: event.target.value })}
          />
        </label>
        <PriceCell
          label={t('inputPrice')}
          value={price.inputPerMtok}
          disabled={disabled}
          onEdit={(text) => props.onEdit({ inputPerMtok: num(text) })}
        />
        <PriceCell
          label={t('outputPrice')}
          value={price.outputPerMtok}
          disabled={disabled}
          onEdit={(text) => props.onEdit({ outputPerMtok: num(text) })}
        />
        <PriceCell
          label={t('cacheReadPrice')}
          value={price.cacheReadPerMtok}
          disabled={disabled}
          onEdit={(text) => props.onEdit({ cacheReadPerMtok: num(text) })}
        />
        <PriceCell
          label={t('cacheWritePrice')}
          value={price.cacheWritePerMtok}
          disabled={disabled}
          onEdit={(text) => props.onEdit({ cacheWritePerMtok: num(text) })}
        />
      </div>
    </div>
  )
}
