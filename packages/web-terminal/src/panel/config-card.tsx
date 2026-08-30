/**
 * 「网页终端」配置卡片：settings.plugin.item 槽位（官方插件配置页）。
 * 外壳与基础控件走 @dsh-plus/shared/client 套件；本文件只保留业务字段。
 * env 为 dict → 卡片内以 KEY=VALUE 多行文本编辑；保存经
 * NamespaceSettingsApi.update 深合并 + revision 乐观锁（对齐 access-gate
 * 卡片模式；失败直接 throw，error.message 即官方错误文本）。
 * @module web-terminal/client/config-card
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
import { type ReactElement, useEffect, useState, useSyncExternalStore } from 'react'

export interface CardProps {
  t(key: string): string
  scope: Scope
  api: NamespaceSettingsApi
}

/** settings 命名空间的解析值（schemastery 默认值齐全）。 */
interface ConfigValue {
  enabled: boolean
  shellPath: string
  shellArgs: string[]
  cwd: string
  env: Record<string, string>
  initialCols: number
  initialRows: number
  scrollbackLines: number
  scrollbackMaxKb: number
  maxSessions: number
  idleTimeoutMs: number
  killGraceMs: number
}

interface Draft {
  enabled: boolean
  shellPath: string
  cwd: string
  envText: string
  scrollbackLines: string
  scrollbackMaxKb: string
  maxSessions: string
  idleTimeoutMs: string
  killGraceMs: string
}

function draftFromValue(value: ConfigValue): Draft {
  return {
    enabled: value.enabled,
    shellPath: value.shellPath,
    cwd: value.cwd,
    envText: Object.entries(value.env ?? {})
      .map(([key, val]) => `${key}=${val}`)
      .join('\n'),
    scrollbackLines: String(value.scrollbackLines),
    scrollbackMaxKb: String(value.scrollbackMaxKb),
    maxSessions: String(value.maxSessions),
    idleTimeoutMs: String(value.idleTimeoutMs),
    killGraceMs: String(value.killGraceMs),
  }
}

function envTextToRecord(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
  }
  return env
}

function toPatch(draft: Draft): Record<string, unknown> {
  const numeric = (raw: string, fallback: number): number => {
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
  }
  return {
    enabled: draft.enabled,
    shellPath: draft.shellPath,
    cwd: draft.cwd,
    env: envTextToRecord(draft.envText),
    scrollbackLines: numeric(draft.scrollbackLines, 10000),
    scrollbackMaxKb: numeric(draft.scrollbackMaxKb, 4096),
    maxSessions: numeric(draft.maxSessions, 8),
    idleTimeoutMs: numeric(draft.idleTimeoutMs, 1800000),
    killGraceMs: numeric(draft.killGraceMs, 2000),
  }
}

export function ConfigCard(props: CardProps): ReactElement {
  const { t, scope, api } = props
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as ConfigValue | undefined
  const [draft, setDraft] = useState<Draft | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)

  useEffect(() => {
    if (value !== undefined && draft === null) setDraft(draftFromValue(value))
  }, [value, draft])

  if (snapshot.status === 'loading' || draft === null || value === undefined) {
    return <div className="wtc-loading">…</div>
  }
  if (snapshot.status === 'unavailable')
    return <div className="wtc-loading">{t('state.disabled')}</div>

  const dirty = JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(draftFromValue(value)))
  const disabled = !snapshot.writable

  const onSave = (): void => {
    setSaving(true)
    const revision = scope.getSnapshot().revision
    api
      .update(toPatch(draft), revision)
      .then(async () => {
        await scope.load()
        const next = scope.getSnapshot().value as ConfigValue | undefined
        if (next !== undefined) setDraft(draftFromValue(next))
        setStatus({ kind: 'ok', text: t('config.saved') })
      })
      .catch((error: unknown) => {
        setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => setSaving(false))
  }

  const edit = (partial: Partial<Draft>): void => setDraft({ ...draft, ...partial })

  return (
    <CardChrome
      prefix="wtc"
      title={t('config.title')}
      description={t('config.description')}
      open={open}
      onToggle={setOpen}
      statusBadge={{
        text: t(draft.enabled ? 'config.enabledOn' : 'config.enabledOff'),
        on: draft.enabled,
      }}
      dirty={dirty}
      dirtyLabel={t('config.unsaved')}
      readOnlyNotice={disabled ? t('config.readOnly') : undefined}
      status={status}
      actions={[
        {
          key: 'discard',
          label: t('dialog.cancel'),
          disabled: !dirty || saving,
          onClick: () => {
            setDraft(draftFromValue(value))
            setStatus(IDLE_STATUS)
          },
        },
        {
          key: 'save',
          label: t('dialog.save'),
          variant: 'primary',
          disabled: !dirty || saving || disabled,
          onClick: onSave,
        },
      ]}
    >
      <CheckRow
        prefix="wtc"
        id="wtc-enabled"
        label={t('config.enabled')}
        checked={draft.enabled}
        disabled={disabled}
        onEdit={(enabled) => edit({ enabled })}
      />
      <TextField
        prefix="wtc"
        id="wtc-shell"
        label={t('config.shellPath')}
        hint={t('config.shellPath.hint')}
        value={draft.shellPath}
        disabled={disabled}
        onEdit={(shellPath) => edit({ shellPath })}
      />
      <TextField
        prefix="wtc"
        id="wtc-cwd"
        label={t('config.cwd')}
        hint={t('config.cwd.hint')}
        value={draft.cwd}
        disabled={disabled}
        onEdit={(cwd) => edit({ cwd })}
      />
      <TextField
        prefix="wtc"
        id="wtc-lines"
        label={t('config.scrollbackLines')}
        value={draft.scrollbackLines}
        numeric
        disabled={disabled}
        onEdit={(scrollbackLines) => edit({ scrollbackLines })}
      />
      <TextField
        prefix="wtc"
        id="wtc-kb"
        label={t('config.scrollbackMaxKb')}
        value={draft.scrollbackMaxKb}
        numeric
        disabled={disabled}
        onEdit={(scrollbackMaxKb) => edit({ scrollbackMaxKb })}
      />
      <TextField
        prefix="wtc"
        id="wtc-max"
        label={t('config.maxSessions')}
        value={draft.maxSessions}
        numeric
        disabled={disabled}
        onEdit={(maxSessions) => edit({ maxSessions })}
      />
      <TextField
        prefix="wtc"
        id="wtc-idle"
        label={t('config.idleTimeoutMs')}
        value={draft.idleTimeoutMs}
        numeric
        disabled={disabled}
        onEdit={(idleTimeoutMs) => edit({ idleTimeoutMs })}
      />
      <TextField
        prefix="wtc"
        id="wtc-grace"
        label={t('config.killGraceMs')}
        value={draft.killGraceMs}
        numeric
        disabled={disabled}
        onEdit={(killGraceMs) => edit({ killGraceMs })}
      />
    </CardChrome>
  )
}
