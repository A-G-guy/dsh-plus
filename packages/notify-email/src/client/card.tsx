/**
 * 「邮件通知」配置卡片：经 injectPluginConfigCard 注册（插件页 plugins.row.config /
 * plugins.bundle.config，view 分发 summary/page）。
 * 外壳与基础控件走 @dsh-plus/shared/client 套件（CardChrome/TextField/CheckRow），
 * 本文件只保留业务字段与保存/测试逻辑。交互对齐官方卡片：折叠/展开、
 * staged draft、未保存标记、保存/放弃；另加「发送测试邮件」。
 * 配置读写经 ctx.remote.settings 直连（connection.api.settings
 * 已移除）：value 为 schema 解析后的脱敏视图
 * （smtp.pass 不出现，passConfigured 由 describe 的 secrets 探测），
 * 保存经 settings.update 深合并（空 pass 剔除 = 保持不变）。
 * @module notify-email/client/card
 */

import {
  type CardAction,
  CardChrome,
  CardLoading,
  type CardStatusState,
  CheckRow,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type PluginConfigViewProps,
  type Scope,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { SETTINGS_NS } from '../ns.ts'
import { sendTest } from './api.ts'
import {
  type ConfigValue,
  type Draft,
  draftFromValue,
  isPositiveInt,
  type TriggerKey,
  toPatch,
} from './draft.ts'
import { SmtpFields, TriggerFields } from './fields.tsx'
import type { Translate } from './i18n.ts'

export interface CardProps extends PluginConfigViewProps {
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

/**
 * passConfigured 探测：scope 快照不含 secrets，经 describe 的 secrets 列表判断；
 * snapshot 变化（保存后 revision 推进）时刻意重探。
 */
function usePassConfigured(api: NamespaceSettingsApi, snapshot: unknown): boolean {
  const [passConfigured, setPassConfigured] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot 变化（保存后 revision 推进）时刻意重探 secrets 状态
  useEffect(() => {
    let alive = true
    api
      .describe()
      .then((view) => {
        if (!alive) return
        const ns = view.namespaces.find((candidate) => candidate.ns === SETTINGS_NS)
        setPassConfigured(
          ns?.secrets.some((secret) => secret.path.join('.') === 'smtp.pass' && secret.set) ??
            false,
        )
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api, snapshot])
  return passConfigured
}

/** 卡片动作：发送测试、放弃、保存（保存受无效字段与只读限制）。 */
function cardActions(options: {
  t: Translate
  dirty: boolean
  invalid: boolean
  saving: boolean
  testing: boolean
  disabled: boolean
  onTest(): void
  onDiscard(): void
  onSave(): void
}): CardAction[] {
  const { t } = options
  return [
    {
      key: 'test',
      label: t(options.testing ? 'testing' : 'test'),
      disabled: options.testing,
      onClick: options.onTest,
    },
    {
      key: 'discard',
      label: t('discard'),
      disabled: !options.dirty || options.saving,
      onClick: options.onDiscard,
    },
    {
      key: 'save',
      label: t(options.saving ? 'saving' : 'save'),
      variant: 'primary',
      disabled: !options.dirty || options.invalid || options.saving || options.disabled,
      onClick: options.onSave,
    },
  ]
}

/** 发送测试邮件：端点结果折算成状态行文案（不改草稿）；finally 收尾由调用方给。 */
function sendTestMail(
  t: Translate,
  onStatus: (status: CardStatusState) => void,
  onSettled: () => void,
): void {
  sendTest()
    .then((result) => {
      if (result.ok) {
        onStatus({
          kind: 'ok',
          text: result.detail === 'dry-run' ? t('testDryRun') : t('testOk'),
        })
        return
      }
      const why = result.detail === 'incomplete' ? t('incomplete') : result.detail
      onStatus({ kind: 'error', text: `${t('testFailed')}${why}` })
    })
    .catch((error: unknown) => {
      onStatus({
        kind: 'error',
        text: `${t('testFailed')}${error instanceof Error ? error.message : ''}`,
      })
    })
    .finally(onSettled)
}

export function NotifyEmailCard(props: CardProps): ReactElement | string | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)
  const passConfigured = usePassConfigured(api, snapshot)

  // 首次拿到解析值后播种草稿；后续 Host 更新不覆盖在途编辑（与官方 staged 表单一致）。
  useEffect(() => {
    if (value === undefined || draft !== null) return
    setDraft(draftFromValue(value))
  }, [value, draft])

  const dirty = useMemo(
    () =>
      value !== undefined &&
      draft !== null &&
      JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFromValue(value))),
    [value, draft],
  )
  const invalid = useMemo(
    () =>
      draft !== null &&
      (!isPositiveInt(draft.port) ||
        !isPositiveInt(draft.idleDebounceMs) ||
        !isPositiveInt(draft.maxBodyChars) ||
        Number(draft.maxBodyChars) < 200),
    [draft],
  )

  // 插件页 summary 视图只出一行简介（hooks 已全部落定，可安全提前返回）。
  if (props.view === 'summary') return t('summaryLine')

  if (value === undefined || draft === null) {
    return <CardLoading prefix="dne" text={t('loading')} />
  }
  const edit = <K extends keyof Draft>(key: K, editValue: Draft[K]): void => {
    setDraft({ ...draft, [key]: editValue })
    setStatus(IDLE_STATUS)
  }
  const editTrigger = (key: TriggerKey, checked: boolean): void => {
    edit('triggers', { ...draft.triggers, [key]: checked })
  }
  const onSave = (): void => {
    setSaving(true)
    const patch = toPatch(draft)
    if ((patch['smtp'] as Record<string, unknown>)['pass'] === '') {
      delete (patch['smtp'] as Record<string, unknown>)['pass']
    }
    const revision = scope.getSnapshot().revision
    api
      .update(patch, revision)
      .then(async () => {
        await scope.load()
        const next = scope.getSnapshot().value as ConfigValue | undefined
        if (next !== undefined) setDraft(draftFromValue(next))
        setStatus(IDLE_STATUS)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${t('saveFailed')}${message}` })
      })
      .finally(() => setSaving(false))
  }
  const onTest = (): void => {
    setTesting(true)
    sendTestMail(t, setStatus, () => setTesting(false))
  }

  const disabled = !snapshot.writable
  return (
    <CardChrome
      prefix="dne"
      title={t('title')}
      description={t('description')}
      statusBadge={{ text: t(draft.enabled ? 'enabledOn' : 'enabledOff'), on: draft.enabled }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={cardActions({
        t,
        dirty,
        invalid,
        saving,
        testing,
        disabled,
        onTest,
        onDiscard: () => {
          setDraft(draftFromValue(value))
          setStatus(IDLE_STATUS)
        },
        onSave,
      })}
    >
      <CheckRow
        prefix="dne"
        id="dne-enabled"
        label={t('enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(v) => edit('enabled', v)}
      />
      <SmtpFields
        t={t}
        draft={draft}
        disabled={disabled}
        passConfigured={passConfigured}
        onEdit={edit}
      />
      <TriggerFields
        t={t}
        draft={draft}
        disabled={disabled}
        onEdit={edit}
        onTrigger={editTrigger}
      />
    </CardChrome>
  )
}
