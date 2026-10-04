/**
 * 「Actual Budget 连接」配置卡片：经 injectPluginConfigCard 注册（插件页
 * plugins.row.config / plugins.bundle.config，view 分发 summary/page）。
 *
 * 编辑范围覆盖全部可公开字段与三行密钥：非密钥字段走 settings 草稿（脏判定 +
 * 保存按钮），密钥走官方 credentials seam（各自即时保存，与草稿互不干扰）。
 * 剩余无编辑器的字段在卡片内给出明确落点（见 i18n 的 advancedBody）——按
 * 《插件开发指南》，可配置项要么有编辑器、要么写明为什么没有与改在哪里配。
 *
 * 字段按主题拆成小节组件，卡片本体只负责外壳、状态与保存动作。
 * @module @dsh-plus/actual/client/card
 */

import {
  CardChrome,
  CardLoading,
  CheckRow,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
  SelectField,
  TextField,
  useNamespaceDraft,
} from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'

import {
  type ConfigValue,
  type Draft,
  type DraftViolation,
  draftFromValue,
  patchFromDraft,
  validateDraft,
} from './draft.ts'
import type { Translate } from './i18n.ts'
import type { CredentialsRemoteFace } from './secrets.ts'
import { SecretsSection } from './secrets-section.tsx'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
  credentials: CredentialsRemoteFace
}

/** 小节共用的 props。 */
interface SectionProps {
  t: Translate
  draft: Draft
  disabled: boolean
  violation: DraftViolation | undefined
  onEdit(patch: Partial<Draft>): void
}

/** 模块级稳定函数：参与 useNamespaceDraft 的依赖比较。 */
function fromValue(value: ConfigValue): Draft {
  return draftFromValue(value)
}

function toPatch(draft: Draft): Record<string, unknown> {
  return patchFromDraft(draft)
}

/**
 * 条件式 invalid 属性：`exactOptionalPropertyTypes` 下不可显式传 `invalidLabel: undefined`，
 * 只能按「有文案才带该键」构造。
 */
function violationProps(
  active: boolean,
  label: string,
): { invalid: boolean; invalidLabel?: string } {
  return active ? { invalid: true, invalidLabel: label } : { invalid: false }
}

/** 说明段落（无编辑器的字段在此交代落点）。 */
function Note(props: { title: string; body: string }): ReactElement {
  return (
    <div className="act-note">
      <p className="act-noteTitle">{props.title}</p>
      <p className="act-noteBody">{props.body}</p>
    </div>
  )
}

/** 连接小节：服务器地址、预算、CLI 命令与版本策略。 */
function ConnectionSection(props: SectionProps): ReactElement {
  const { t, draft, disabled, violation, onEdit } = props
  return (
    <>
      <TextField
        prefix="act"
        id="act-server-url"
        label={t('serverUrl')}
        hint={t('serverUrlHint')}
        value={draft.serverUrl}
        disabled={disabled}
        {...violationProps(violation?.field === 'serverUrl', t('serverUrlInvalid'))}
        onEdit={(value) => onEdit({ serverUrl: value })}
      />
      <TextField
        prefix="act"
        id="act-sync-id"
        label={t('syncId')}
        hint={t('syncIdHint')}
        value={draft.syncId}
        disabled={disabled}
        onEdit={(value) => onEdit({ syncId: value })}
      />
      <TextField
        prefix="act"
        id="act-cli-command"
        label={t('cliCommand')}
        hint={t('cliCommandHint')}
        value={draft.cliCommand}
        disabled={disabled}
        {...violationProps(violation?.field === 'cliCommand', t('cliCommandInvalid'))}
        onEdit={(value) => onEdit({ cliCommand: value })}
      />
      <SelectField
        prefix="act"
        id="act-version-policy"
        label={t('cliVersionPolicy')}
        hint={t('cliVersionPolicyHint')}
        value={draft.cliVersionPolicy}
        options={[
          { value: 'warn', label: t('policyWarn') },
          { value: 'strict', label: t('policyStrict') },
        ]}
        disabled={disabled}
        onEdit={(value) => onEdit({ cliVersionPolicy: value === 'strict' ? 'strict' : 'warn' })}
      />
    </>
  )
}

/** 行为小节：写确认、辅助工具与工具名前缀。 */
function PolicySection(props: SectionProps): ReactElement {
  const { t, draft, disabled, violation, onEdit } = props
  return (
    <>
      <CheckRow
        prefix="act"
        id="act-confirm-writes"
        label={t('confirmWrites')}
        checked={draft.confirmWrites}
        disabled={disabled}
        onEdit={(value) => onEdit({ confirmWrites: value })}
      />
      <p className="act-noteBody">{t('confirmWritesHint')}</p>
      <CheckRow
        prefix="act"
        id="act-aux-tools"
        label={t('auxTools')}
        checked={draft.auxTools}
        disabled={disabled}
        onEdit={(value) => onEdit({ auxTools: value })}
      />
      <p className="act-noteBody">{t('auxToolsHint')}</p>
      <TextField
        prefix="act"
        id="act-name-prefix"
        label={t('namePrefix')}
        hint={t('namePrefixHint')}
        value={draft.namePrefix}
        disabled={disabled}
        {...violationProps(violation?.field === 'namePrefix', t('namePrefixInvalid'))}
        onEdit={(value) => onEdit({ namePrefix: value })}
      />
    </>
  )
}

export function ActualCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api, credentials } = props
  const { draft, dirty, saving, status, disabled, edit, reset, save } = useNamespaceDraft<
    ConfigValue,
    Draft
  >({ scope, api, from: fromValue, patch: toPatch, saveFailedLabel: t('saveFailed') })

  if (props.view === 'summary') return t('summaryLine')
  if (draft === null) return <CardLoading prefix="act" text={t('loading')} />

  const violation = validateDraft(draft)
  const section: SectionProps = { t, draft, disabled, violation, onEdit: edit }

  return (
    <CardChrome
      prefix="act"
      title={t('title')}
      description={t('description')}
      statusBadge={{ text: t(draft.enabled ? 'enabledOn' : 'enabledOff'), on: draft.enabled }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={[
        { key: 'discard', label: t('discard'), disabled: !dirty || saving, onClick: reset },
        {
          key: 'save',
          label: t(saving ? 'saving' : 'save'),
          variant: 'primary',
          disabled: !dirty || saving || violation !== undefined || disabled,
          onClick: save,
        },
      ]}
    >
      <CheckRow
        prefix="act"
        id="act-enabled"
        label={t('enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(value) => edit({ enabled: value })}
      />
      <p className="act-noteBody">{t('enabledHint')}</p>
      <ConnectionSection {...section} />
      <SecretsSection t={t} face={credentials} />
      <PolicySection {...section} />
      <Note title={t('advancedTitle')} body={t('advancedBody')} />
    </CardChrome>
  )
}
