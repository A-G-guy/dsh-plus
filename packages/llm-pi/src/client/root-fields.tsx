/**
 * 卡片根字段组：总开关 + 运行期状态行。
 *
 * 状态行回答的是"我现在到底在跑哪一份 pi-ai"——插件按文件路径动态加载已装 dsh 树
 * 里的套件（见 resolve-dsh.ts），manifest 上写的版本**不是**生效版本。这里显示
 * 生效版本、安装树、目录规模与数据日期、可服务协议、compat 表来源，以及逐项降级
 * 诊断；版本超出验证区间时给出提示（提示而非阻断）。
 * @module llm-pi/client/root-fields
 */

import { CheckRow } from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'

import type { WireKitInfo } from './api.ts'
import type { Draft } from './draft.ts'
import type { Translate } from './i18n.ts'

/** 时间戳 → 本地日期（秒级精度足够）。 */
function formatTime(ms: number | undefined, fallback: string): string {
  if (ms === undefined || !Number.isFinite(ms)) return fallback
  return new Date(ms).toLocaleString()
}

/** 生效版本三连（缺失显示"未知"）。 */
function versionsText(kit: WireKitInfo, t: Translate): string {
  const unknown = t('runtimeVersionUnknown')
  return [
    `pi-ai ${kit.versions.piAi ?? unknown}`,
    `dsh-llm-pi-ai ${kit.versions.piAiAdapter ?? unknown}`,
    ...(kit.versions.dsh === undefined ? [] : [`dsh ${kit.versions.dsh}`]),
  ].join(' · ')
}

/** 来源标签：现场推导 / 回退快照。 */
function sourceLabel(t: Translate, source: string): string {
  return source === 'official' ? t('runtimeDerived') : t('runtimeFallback')
}

/** 应急副本状态行：路径 · route 数 · 生成时间；未生成/失败显式提示。 */
function officialCopyText(kit: WireKitInfo, t: Translate): string {
  const copy = kit.officialCopy
  if (copy.error !== undefined) return `${t('officialCopyFailed')}${copy.error}`
  if (copy.updatedAt === undefined) return t('officialCopyPending')
  return `${copy.path} · ${copy.routes} ${t('officialCopyRoutes')} · ${formatTime(copy.updatedAt, t('runtimeVersionUnknown'))}`
}

export interface RootFieldsProps {
  t: Translate
  draft: Draft
  disabled: boolean
  kit: WireKitInfo | null
  /** 目录索引拉取失败原因（失败时状态行显式提示，其余字段照常可编辑）。 */
  kitError: string
  /** 根字段编辑（合并式写入并清空状态行）。 */
  onEdit(patch: Partial<Draft>): void
}

export function RootFields(props: RootFieldsProps): ReactElement {
  const { t, draft, disabled, kit, onEdit } = props
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
      <p className="lpc-groupLabel">{t('runtimeGroup')}</p>
      {props.kitError !== '' ? (
        <p className="lpc-invalid">{`${t('browserFailed')}${props.kitError}`}</p>
      ) : null}
      {kit === null ? (
        <p className="lpc-hint">{t('browserLoading')}</p>
      ) : (
        <>
          <p className="lpc-statusRow">
            {`${t('runtimeSource')}：${kit.source}${kit.root === undefined ? '' : ` · ${t('runtimeRoot')} ${kit.root}`}`}
          </p>
          <p className="lpc-statusRow">{`${t('runtimeVersions')}：${versionsText(kit, t)}`}</p>
          <p className="lpc-statusRow">
            {`${t('runtimeCatalog')}：${kit.catalog.providers} ${t('runtimeCatalogUnit')} ${kit.catalog.models} ${t('runtimeCatalogModels')} · ${t('runtimeCatalogGenerated')} ${formatTime(kit.catalog.generatedAt, t('runtimeVersionUnknown'))}`}
          </p>
          <p className="lpc-statusRow">
            {`${t('runtimeProtocols')}：${kit.protocols.join(' / ')}（${sourceLabel(t, kit.protocolSource)}）`}
          </p>
          <p className="lpc-statusRow">
            {`${t('runtimeCompat')}：${sourceLabel(t, kit.compatSource)}`}
          </p>
          <p className="lpc-statusRow">
            {`${t('runtimeOfficialCopy')}：${officialCopyText(kit, t)}`}
          </p>
          {kit.versionNotice !== undefined ? (
            <p className="lpc-invalid">{`${t('runtimeNotice')}：${kit.versionNotice}`}</p>
          ) : null}
          {kit.diagnostics.length > 0 ? (
            <>
              <p className="lpc-catDetailLabel">{t('runtimeDiagnostics')}</p>
              <pre className="lpc-catJson">{kit.diagnostics.join('\n')}</pre>
            </>
          ) : null}
        </>
      )}
    </>
  )
}
