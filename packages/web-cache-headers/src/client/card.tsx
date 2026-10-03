/**
 * 「静态资源长缓存」配置卡片：经 injectPluginConfigCard 注册（插件页
 * plugins.row.config / plugins.bundle.config，view 分发 summary/page）。
 * 只有 enabled 一个字段：关闭即卸下 writeHead 补丁；范围说明写进卡片
 * （哪些路径不在范围内），避免用户误以为能缓存 index.html。
 * 外壳与控件走 @dsh-plus/shared/client 套件（CardChrome/CheckRow/useNamespaceDraft）。
 * @module web-cache-headers/client/card
 */

import {
  CardChrome,
  CardLoading,
  CheckRow,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
  useNamespaceDraft,
} from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'

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

export function WebCacheHeadersCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api } = props
  const { draft, dirty, saving, status, disabled, edit, reset, save } = useNamespaceDraft<
    ConfigValue,
    Draft
  >({ scope, api, from: draftFromValue, patch: toPatch, saveFailedLabel: t('saveFailed') })
  // 插件页 page 视图为表单落地页，默认展开；旧槽位无 view，保持折叠。

  // 插件页 summary 视图只出一行简介（hooks 已全部落定，可安全提前返回）。
  if (props.view === 'summary') return t('summaryLine')

  if (draft === null) return <CardLoading prefix="wch" text={t('loading')} />

  return (
    <CardChrome
      prefix="wch"
      title={t('title')}
      description={t('description')}
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
        prefix="wch"
        id="wch-enabled"
        label={t('enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(v) => edit({ enabled: v })}
      />
      <p className="wch-hint">{t('enabledHint')}</p>
      <p className="wch-scope">{t('scopeHint')}</p>
    </CardChrome>
  )
}
