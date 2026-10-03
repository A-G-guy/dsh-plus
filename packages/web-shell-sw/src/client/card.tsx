/**
 * 「外壳 Service Worker」配置卡片：经 injectPluginConfigCard 注册（legacy
 * settings.plugin.item 与插件页 plugins.row.config / plugins.bundle.config，
 * view 分发 summary/page）。
 * 只有 enabled 一个字段。生效时机（页面加载阶段）与安全上下文限制写进卡片，
 * 避免用户以为开关即时改变当前页的注册状态。
 * 外壳与控件走 @dsh-plus/shared/client 套件（CardChrome/CheckRow/useNamespaceDraft）。
 * @module web-shell-sw/client/card
 */

import {
  CardChrome,
  CardLoading,
  CheckRow,
  cardVariantFor,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
  useNamespaceDraft,
} from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'

import type { Translate } from './i18n.ts'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

/** settings 命名空间的解析值。 */
export interface ConfigValue {
  enabled: boolean
}

interface Draft {
  enabled: boolean
}

/** 模块级稳定函数：参与 useNamespaceDraft 的依赖比较。 */
function draftFromValue(value: ConfigValue): Draft {
  return { enabled: value.enabled }
}

function toPatch(draft: Draft): Record<string, unknown> {
  return { enabled: draft.enabled }
}

export function ShellSwCard(props: CardProps): ReactElement | string | null {
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
  if (draft === null) return <CardLoading prefix="wss" variant={variant} text={t('loading')} />

  return (
    <CardChrome
      prefix="wss"
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
          disabled: !dirty || saving || disabled,
          onClick: save,
        },
      ]}
    >
      <CheckRow
        prefix="wss"
        id="wss-enabled"
        label={t('enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(v) => edit({ enabled: v })}
      />
      <p className="wss-hint">{t('enabledHint')}</p>
      <p className="wss-note">{t('reloadHint')}</p>
      <p className="wss-note">{t('envHint')}</p>
    </CardChrome>
  )
}
