/**
 * 「搜索后端聚合」配置卡片：经 injectPluginConfigCard 注册（legacy
 * settings.plugin.item 与插件页 plugins.row.config / plugins.bundle.config，
 * view 分发 summary/page）。
 * 字段：scriptPath / envFile / python / priority（每行一个后端）/ timeoutMs。
 * 密钥不走卡片：keys 段的 role(secret) 字段只允许 profile 行级注入，用户层
 * 写入会被脱敏遮蔽——卡片改为把密钥来源（env 文件）与覆盖方式写在页面上。
 * 外壳与控件走 @dsh-plus/shared/client 套件（CardChrome/TextField/
 * useNamespaceDraft）；纯校验逻辑在同目录 draft.ts（node --test 可直测）。
 * @module web-search-services/client/card
 */

import {
  CardChrome,
  CardLoading,
  cardVariantFor,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
  TextField,
  useNamespaceDraft,
} from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'

import {
  type ConfigValue,
  type Draft,
  draftFromValue,
  priorityTextOk,
  timeoutTextOk,
  toPatch,
} from './draft.ts'
import type { Translate } from './i18n.ts'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

export function WebSearchServicesCard(props: CardProps): ReactElement | string | null {
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
  if (draft === null) return <CardLoading prefix="wsv" variant={variant} text={t('loading')} />

  const priorityInvalid = !priorityTextOk(draft.priorityText)
  const timeoutInvalid = !timeoutTextOk(draft.timeoutMsText)
  return (
    <CardChrome
      prefix="wsv"
      title={t('title')}
      description={t('description')}
      open={open}
      onToggle={setOpen}
      variant={variant}
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
          disabled: !dirty || priorityInvalid || timeoutInvalid || saving || disabled,
          onClick: save,
        },
      ]}
    >
      <TextField
        prefix="wsv"
        id="wsv-script"
        label={t('scriptPath')}
        hint={t('scriptPathHint')}
        value={draft.scriptPath}
        disabled={disabled}
        onEdit={(v) => edit({ scriptPath: v })}
      />
      <TextField
        prefix="wsv"
        id="wsv-envfile"
        label={t('envFile')}
        hint={t('envFileHint')}
        value={draft.envFile}
        disabled={disabled}
        onEdit={(v) => edit({ envFile: v })}
      />
      <TextField
        prefix="wsv"
        id="wsv-python"
        label={t('python')}
        hint={t('pythonHint')}
        value={draft.python}
        disabled={disabled}
        onEdit={(v) => edit({ python: v })}
      />
      <div className="wsv-field">
        <div className="wsv-head">
          <label className="wsv-label" htmlFor="wsv-priority">
            {t('priority')}
          </label>
        </div>
        <textarea
          id="wsv-priority"
          className="wsv-priority"
          rows={3}
          value={draft.priorityText}
          disabled={disabled}
          onChange={(event) => edit({ priorityText: event.target.value })}
        />
        <p className={priorityInvalid ? 'wsv-invalid' : 'wsv-hint'}>
          {priorityInvalid ? t('invalidPriority') : t('priorityHint')}
        </p>
      </div>
      <TextField
        prefix="wsv"
        id="wsv-timeout"
        label={t('timeoutMs')}
        hint={t('timeoutMsHint')}
        value={draft.timeoutMsText}
        numeric
        disabled={disabled}
        invalid={timeoutInvalid}
        invalidLabel={t('invalidTimeout')}
        onEdit={(v) => edit({ timeoutMsText: v })}
      />
      <div className="wsv-keys">
        <p className="wsv-keysTitle">{t('keysGroup')}</p>
        <p className="wsv-hint">{t('keysHint')}</p>
        <p className="wsv-hint">{t('keysUserLayerHint')}</p>
      </div>
      <p className="wsv-hint">{t('reloadHint')}</p>
    </CardChrome>
  )
}
