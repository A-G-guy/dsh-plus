/**
 * 卡片根字段组：总开关 + 运行期状态行。
 *
 * 状态行回答的是"我现在到底在跑哪一份 pi-ai"——插件按文件路径动态加载已装 dsh 树
 * 里的套件（见 resolve-dsh.ts），manifest 上写的版本**不是**生效版本。这里显示
 * 生效版本、安装树、目录规模与数据日期、可服务协议、compat 表来源，以及诊断
 * （按「形态说明 / 降级诊断」分块，避免恒定事实淹没真实降级）；版本超出验证区间
 * 时给出提示（提示而非阻断）。
 * @module llm-pi/client/root-fields
 */

import { CheckRow } from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'

import type { WireDiagnostic, WireKitInfo } from './api.ts'
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

/**
 * 诊断分块：形态说明与降级分开渲染——「官方 src 不随 npm 发布」这类恒定事实
 * 永不会消失，混在一起会把真正的降级淹掉。空块不渲染。
 */
function DiagnosticBlock(props: {
  label: string
  level: WireDiagnostic['level']
  items: readonly WireDiagnostic[]
}): ReactElement | null {
  const messages = props.items.filter((item) => item.level === props.level).map((m) => m.message)
  if (messages.length === 0) return null
  return (
    <>
      <p className="lpc-catDetailLabel">{props.label}</p>
      <pre className="lpc-catJson">{messages.join('\n')}</pre>
    </>
  )
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
              <DiagnosticBlock label={t('runtimeFormNotes')} level="info" items={kit.diagnostics} />
              <DiagnosticBlock
                label={t('runtimeDiagnostics')}
                level="degradation"
                items={kit.diagnostics}
              />
            </>
          ) : null}
        </>
      )}
    </>
  )
}
