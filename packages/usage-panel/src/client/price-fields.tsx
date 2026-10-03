/**
 * 价目卡片的全局字段组：货币、目录代理、两个间隔（数值以文本承载，
 * 越界即标红并让调用方禁用保存）。
 * @module usage-panel/client/price-fields
 */

import { TextField } from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'

import type { Translate } from './i18n.ts'

/** 非负整数文本（间隔类字段：不接受小数）。 */
function intTextOk(text: string): boolean {
  return /^\d+$/.test(text.trim())
}

/** 间隔字段的上界（与 config.ts 的 schema 约束一致）。 */
export const AUTO_SYNC_MAX_MINUTES = 1440
export const CATALOG_REFRESH_MAX_HOURS = 720

export interface PriceGlobalFieldsProps {
  t: Translate
  draft: {
    currency: string
    catalogProxy: string
    autoSyncMinutes: string
    catalogRefreshHours: string
  }
  disabled: boolean
  onEdit(patch: Partial<PriceGlobalFieldsProps['draft']>): void
}

export function PriceGlobalFields(props: PriceGlobalFieldsProps): ReactElement {
  const { t, draft, disabled } = props
  const syncInvalid =
    !intTextOk(draft.autoSyncMinutes) || Number(draft.autoSyncMinutes) > AUTO_SYNC_MAX_MINUTES
  const refreshInvalid =
    !intTextOk(draft.catalogRefreshHours) ||
    Number(draft.catalogRefreshHours) > CATALOG_REFRESH_MAX_HOURS
  return (
    <>
      <TextField
        prefix="dup"
        id="dup-currency"
        label={t('currency')}
        value={draft.currency}
        disabled={disabled}
        onEdit={(v) => props.onEdit({ currency: v })}
      />
      <TextField
        prefix="dup"
        id="dup-proxy"
        label={t('catalogProxyLabel')}
        hint={t('catalogProxyHint')}
        value={draft.catalogProxy}
        disabled={disabled}
        onEdit={(v) => props.onEdit({ catalogProxy: v })}
      />
      <TextField
        prefix="dup"
        id="dup-autosync"
        label={t('autoSyncMinutes')}
        hint={t('autoSyncMinutesHint')}
        value={draft.autoSyncMinutes}
        numeric
        disabled={disabled}
        invalid={syncInvalid}
        invalidLabel={t('invalidMinutes')}
        onEdit={(v) => props.onEdit({ autoSyncMinutes: v })}
      />
      <TextField
        prefix="dup"
        id="dup-refreshhours"
        label={t('catalogRefreshHours')}
        hint={t('catalogRefreshHoursHint')}
        value={draft.catalogRefreshHours}
        numeric
        disabled={disabled}
        invalid={refreshInvalid}
        invalidLabel={t('invalidHours')}
        onEdit={(v) => props.onEdit({ catalogRefreshHours: v })}
      />
    </>
  )
}

/** 价目来源提示：已导入条数 / 空表引导（两者互斥，空表且无导入才提示）。 */
export function PriceHints(props: {
  t: Translate
  importedCount: number
  hasStoredState: boolean
  manualCount: number
}): ReactElement | null {
  if (props.importedCount > 0) {
    return (
      <p className="dup-empty">
        {props.t('importedPrices').replace('{n}', String(props.importedCount))}
      </p>
    )
  }
  if (!props.hasStoredState && props.manualCount === 0) {
    return <p className="dup-empty">{props.t('priceHint')}</p>
  }
  return null
}
