/**
 * 「启动计时观测」配置卡片：经 injectPluginConfigCard 注册（legacy
 * settings.plugin.item 与插件页 plugins.row.config / plugins.bundle.config，
 * view 分发 summary/page）。
 * 字段：enabled + settleMs（结算延迟）。数值以文本承载、越界即判无效并禁用保存；
 * 生效时机（页面加载阶段）与报告输出去向写进卡片。
 * 外壳与控件走 @dsh-plus/shared/client 套件（CardChrome/CheckRow/TextField/
 * useNamespaceDraft）。
 * @module web-boot-timing/client/card
 */

import {
  CardChrome,
  CardLoading,
  CheckRow,
  cardVariantFor,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
  TextField,
  useNamespaceDraft,
} from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'

import { type ConfigValue, type Draft, draftFromValue, settleTextOk, toPatch } from './draft.ts'
import type { Translate } from './i18n.ts'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

export function BootTimingCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api } = props
  const { draft, dirty, saving, status, disabled, edit, reset, save } = useNamespaceDraft<
    ConfigValue,
    Draft
  >({ scope, api, from: draftFromValue, patch: toPatch, saveFailedLabel: t('saveFailed') })
  // 插件页 page 视图为表单落地页，默认展开；旧槽位无 view，保持折叠。
  const [open, setOpen] = useState(props.view === 'page')

  // 插件页 summary 视图只出一行简介（hooks 已全部落定，可安全提前返回）。
  if (props.view === 'summary') return t('summaryLine')

  // 插件页 page 视图内嵌宿主页面容器（已带页面级内边距与标题），用无边框分节。
  const variant = cardVariantFor(props.view)
  if (draft === null) return <CardLoading prefix="wbt" variant={variant} text={t('loading')} />

  const settleInvalid = !settleTextOk(draft.settleMsText)
  return (
    <CardChrome
      prefix="wbt"
      title={t('title')}
      description={t('description')}
      open={open}
      onToggle={setOpen}
      variant={variant}
      statusBadge={{ text: t(draft.enabled ? 'enabledOn' : 'enabledOff'), on: draft.enabled }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={[
        {
          key: 'discard',
          label: t('discard'),
          disabled: !dirty || saving,
          onClick: reset,
        },
        {
          key: 'save',
          label: t(saving ? 'saving' : 'save'),
          variant: 'primary',
          disabled: !dirty || settleInvalid || saving || disabled,
          onClick: save,
        },
      ]}
    >
      <CheckRow
        prefix="wbt"
        id="wbt-enabled"
        label={t('enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(v) => edit({ enabled: v })}
      />
      <p className="wbt-hint">{t('enabledHint')}</p>
      <TextField
        prefix="wbt"
        id="wbt-settle"
        label={t('settleMs')}
        hint={t('settleMsHint')}
        value={draft.settleMsText}
        numeric
        disabled={disabled}
        invalid={settleInvalid}
        invalidLabel={t('invalidSettle')}
        onEdit={(v) => edit({ settleMsText: v })}
      />
      <p className="wbt-note">{t('reloadHint')}</p>
      <p className="wbt-note">{t('outputHint')}</p>
    </CardChrome>
  )
}
