/**
 * 「邮件通知」配置卡片：注册进 settings.plugin.item 插槽（官方插件配置页）。
 * 外壳与基础控件走 @dsh-plus/shared/client 套件（CardChrome/TextField/CheckRow），
 * 本文件只保留业务字段与保存/测试逻辑。交互对齐官方卡片：折叠/展开、
 * staged draft、未保存标记、保存/放弃；另加「发送测试邮件」。
 * 配置读写经 ctx.remote.settings 直连（0.1.2-alpha.1 起 connection.api.settings
 * 已移除）：value 为 schema 解析后的脱敏视图
 * （smtp.pass 不出现，passConfigured 由 describe 的 secrets 探测），
 * 保存经 settings.update 深合并（空 pass 剔除 = 保持不变）。
 * @module notify-email/client/card
 */

import {
  CardChrome,
  type CardStatusState,
  CheckRow,
  IDLE_STATUS,
  type NamespaceSettingsApi,
  type Scope,
  TextField,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { SETTINGS_NS } from '../ns.ts'
import { sendTest } from './api.ts'

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: NamespaceSettingsApi
}

/** settings 命名空间的脱敏解析值（smtp.pass 被脱敏剥除）。 */
export interface ConfigValue {
  enabled: boolean
  smtp: {
    host: string
    port: number
    secure: boolean
    user: string
    from: string
  }
  to: string[]
  triggers: {
    onComplete: boolean
    onError: boolean
    onAborted: boolean
    onQuestion: boolean
    onPlanReview: boolean
  }
  idleDebounceMs: number
  maxBodyChars: number
  dryRun: boolean
}

interface Draft {
  enabled: boolean
  host: string
  port: string
  secure: boolean
  user: string
  pass: string
  from: string
  toText: string
  triggers: ConfigValue['triggers']
  idleDebounceMs: string
  maxBodyChars: string
  dryRun: boolean
}

function draftFromValue(value: ConfigValue): Draft {
  return {
    enabled: value.enabled,
    host: value.smtp.host,
    port: String(value.smtp.port),
    secure: value.smtp.secure,
    user: value.smtp.user,
    pass: '',
    from: value.smtp.from,
    toText: value.to.join(', '),
    triggers: { ...value.triggers },
    idleDebounceMs: String(value.idleDebounceMs),
    maxBodyChars: String(value.maxBodyChars),
    dryRun: value.dryRun,
  }
}

function isPositiveInt(text: string): boolean {
  return /^[0-9]+$/.test(text) && Number(text) > 0
}

function toPatch(draft: Draft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    smtp: {
      host: draft.host.trim(),
      port: Number(draft.port),
      secure: draft.secure,
      user: draft.user.trim(),
      pass: draft.pass,
      from: draft.from.trim(),
    },
    to: draft.toText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    triggers: { ...draft.triggers },
    idleDebounceMs: Number(draft.idleDebounceMs),
    maxBodyChars: Number(draft.maxBodyChars),
    dryRun: draft.dryRun,
  }
}

const TRIGGER_KEYS = ['onComplete', 'onError', 'onAborted', 'onQuestion', 'onPlanReview'] as const

export function NotifyEmailCard(props: CardProps): ReactElement | null {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [passConfigured, setPassConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)

  // 首次拿到解析值后播种草稿；后续 Host 更新不覆盖在途编辑（与官方 staged 表单一致）。
  useEffect(() => {
    if (value === undefined || draft !== null) return
    setDraft(draftFromValue(value))
  }, [value, draft])

  // passConfigured 探测：scope 快照不含 secrets，经 describe 的 secrets 列表判断。
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

  if (value === undefined || draft === null) {
    return (
      <li className="dne-card">
        <p className="dne-readOnly">{t('loading')}</p>
      </li>
    )
  }
  const edit = <K extends keyof Draft>(key: K, editValue: Draft[K]): void => {
    setDraft({ ...draft, [key]: editValue })
    setStatus(IDLE_STATUS)
  }
  const editTrigger = (key: (typeof TRIGGER_KEYS)[number], checked: boolean): void => {
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
    sendTest()
      .then((result) => {
        if (result.ok) {
          setStatus({
            kind: 'ok',
            text: result.detail === 'dry-run' ? t('testDryRun') : t('testOk'),
          })
        } else {
          const why = result.detail === 'incomplete' ? t('incomplete') : result.detail
          setStatus({ kind: 'error', text: `${t('testFailed')}${why}` })
        }
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          text: `${t('testFailed')}${error instanceof Error ? error.message : ''}`,
        })
      })
      .finally(() => setTesting(false))
  }

  const disabled = !snapshot.writable
  return (
    <CardChrome
      prefix="dne"
      title={t('title')}
      description={t('description')}
      open={open}
      onToggle={setOpen}
      statusBadge={{ text: t(draft.enabled ? 'enabledOn' : 'enabledOff'), on: draft.enabled }}
      dirty={dirty}
      dirtyLabel={t('unsaved')}
      readOnlyNotice={disabled ? t('readOnly') : undefined}
      status={status}
      actions={[
        {
          key: 'test',
          label: t(testing ? 'testing' : 'test'),
          disabled: testing,
          onClick: onTest,
        },
        {
          key: 'discard',
          label: t('discard'),
          disabled: !dirty || saving,
          onClick: () => {
            setDraft(draftFromValue(value))
            setStatus(IDLE_STATUS)
          },
        },
        {
          key: 'save',
          label: t(saving ? 'saving' : 'save'),
          variant: 'primary',
          disabled: !dirty || invalid || saving || disabled,
          onClick: onSave,
        },
      ]}
    >
      <CheckRow
        prefix="dne"
        id="dne-enabled"
        label={t('enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(v) => edit('enabled', v)}
      />
      <TextField
        prefix="dne"
        id="dne-host"
        label={t('host')}
        hint={t('hostHint')}
        value={draft.host}
        disabled={disabled}
        onEdit={(v) => edit('host', v)}
      />
      <TextField
        prefix="dne"
        id="dne-port"
        label={t('port')}
        hint={t('portHint')}
        value={draft.port}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.port)}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => edit('port', v)}
      />
      <CheckRow
        prefix="dne"
        id="dne-secure"
        label={t('secure')}
        checked={draft.secure}
        disabled={disabled}
        onEdit={(v) => edit('secure', v)}
      />
      <TextField
        prefix="dne"
        id="dne-user"
        label={t('user')}
        hint={t('userHint')}
        value={draft.user}
        disabled={disabled}
        onEdit={(v) => edit('user', v)}
      />
      <TextField
        prefix="dne"
        id="dne-pass"
        label={t('pass')}
        hint={t('passHint')}
        value={draft.pass}
        password
        disabled={disabled}
        badge={{
          text: passConfigured ? t('passSet') : t('passUnset'),
          set: passConfigured,
        }}
        onEdit={(v) => edit('pass', v)}
      />
      <TextField
        prefix="dne"
        id="dne-from"
        label={t('from')}
        hint={t('fromHint')}
        value={draft.from}
        disabled={disabled}
        onEdit={(v) => edit('from', v)}
      />
      <TextField
        prefix="dne"
        id="dne-to"
        label={t('to')}
        hint={t('toHint')}
        value={draft.toText}
        disabled={disabled}
        onEdit={(v) => edit('toText', v)}
      />
      <p className="dne-groupLabel">{t('triggerGroup')}</p>
      {TRIGGER_KEYS.map((key) => (
        <CheckRow
          prefix="dne"
          key={key}
          id={`dne-${key}`}
          label={t(key)}
          checked={draft.triggers[key]}
          disabled={disabled}
          onEdit={(v) => editTrigger(key, v)}
        />
      ))}
      <TextField
        prefix="dne"
        id="dne-debounce"
        label={t('idleDebounceMs')}
        hint={t('idleDebounceMsHint')}
        value={draft.idleDebounceMs}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.idleDebounceMs)}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => edit('idleDebounceMs', v)}
      />
      <TextField
        prefix="dne"
        id="dne-maxchars"
        label={t('maxBodyChars')}
        hint={t('maxBodyCharsHint')}
        value={draft.maxBodyChars}
        numeric
        disabled={disabled}
        invalid={!isPositiveInt(draft.maxBodyChars) || Number(draft.maxBodyChars) < 200}
        invalidLabel={t('invalidNumber')}
        onEdit={(v) => edit('maxBodyChars', v)}
      />
      <CheckRow
        prefix="dne"
        id="dne-dryrun"
        label={t('dryRun')}
        checked={draft.dryRun}
        disabled={disabled}
        onEdit={(v) => edit('dryRun', v)}
      />
    </CardChrome>
  )
}
