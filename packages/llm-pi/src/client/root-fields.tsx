/**
 * 「LLM 路由」卡片的根字段组：总开关、目录端点/刷新间隔/代理，以及运行期诊断行
 * （kitSource 与 models-dev 快照状态，来自模型目录端点而非配置数据）。
 * @module llm-pi/client/root-fields
 */

import { CheckRow, TextField } from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'

import type { WireModelsDevStatus } from './api.ts'
import { type Draft, numTextOk } from './draft.ts'
import type { Translate } from './i18n.ts'

/** models-dev 状态行文案（缺席/错误/未拉取/正常四态）。 */
function modelsDevText(status: WireModelsDevStatus | null, t: Translate): string {
  if (status === null) return t('modelsDevEmpty')
  if (status.error !== null) return `${t('modelsDevError')}${status.error}`
  if (status.fetchedAt === null) return t('modelsDevEmpty')
  return `${t('modelsDevStatusLine')}：${status.providers} 个 provider，快照 ${status.fetchedAt}`
}

export interface RootFieldsProps {
  t: Translate
  draft: Draft
  disabled: boolean
  kitSource: string | null
  modelsDevStatus: WireModelsDevStatus | null
  /** 根字段编辑（合并式写入并清空状态行）。 */
  onEdit(patch: Partial<Draft>): void
}

export function RootFields(props: RootFieldsProps): ReactElement {
  const { t, draft, disabled, onEdit } = props
  return (
    <>
      <CheckRow
        prefix="lpc"
        id="lpc-enabled"
        label={t('enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(value) => onEdit({ enabled: value })}
      />
      <TextField
        prefix="lpc"
        id="lpc-catalogUrl"
        label={t('catalogUrl')}
        hint={t('catalogUrlHint')}
        value={draft.catalogUrl}
        disabled={disabled}
        onEdit={(value) => onEdit({ catalogUrl: value })}
      />
      <TextField
        prefix="lpc"
        id="lpc-catalogRefresh"
        label={t('catalogRefreshHours')}
        hint={t('catalogRefreshHoursHint')}
        value={draft.catalogRefreshHours}
        numeric
        disabled={disabled}
        invalid={!numTextOk(draft.catalogRefreshHours)}
        invalidLabel={t('invalidNumber')}
        onEdit={(value) => onEdit({ catalogRefreshHours: value })}
      />
      <TextField
        prefix="lpc"
        id="lpc-catalogProxy"
        label={t('catalogProxy')}
        hint={t('catalogProxyHint')}
        value={draft.catalogProxy}
        disabled={disabled}
        onEdit={(value) => onEdit({ catalogProxy: value })}
      />
      <p className="lpc-statusRow">
        {t('kitSource')}：{props.kitSource ?? ''}
      </p>
      <div className="lpc-statusRow">
        <span>
          {t('modelsDevStatus')}：{modelsDevText(props.modelsDevStatus, t)}
        </span>
      </div>
    </>
  )
}
