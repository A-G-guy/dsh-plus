/**
 * lifeboat 健康页：settings.plugins.tab 第三页「救生艇」。
 * - 应急翻译状态 banner（激活中显示源路由/临时路由/时间）
 * - 已隔离插件卡片 + 「恢复」按钮（两段确认）
 * - journal 时间线（kind 徽标着色）
 * - dsh-plus 兄弟插件状态点（pluginInventory.list）
 * 依赖隔离：本模块被 client.ts 延迟 require，react 系异常不拖垮哨兵。
 * @module lifeboat/client/health-tab
 */

import { getJson, postJson } from '@dsh-plus/shared/client'
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'

import { injectHealthStyle } from './health-styles.ts'

interface JournalEntry {
  at: string
  kind: string
  detail: string
}

interface FallbackState {
  active: boolean
  originalProvider: string
  originalModel: string
  fallbackProvider: string
  at: string
}

interface StatusResponse {
  journal: JournalEntry[]
  llmFallback: FallbackState | null
  quarantined: string[]
}

interface InventoryRow {
  id: string
  enabled: boolean
  status?: number
}

interface RemoteLike {
  pluginInventory: { list(): Promise<{ entries?: InventoryRow[] }> }
}

interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

interface HealthContext {
  slots: SlotsLike
  locale: LocaleLike
  get(key: 'remote'): RemoteLike
  effect(execute: () => () => void, label?: string): unknown
}

const NS = 'dsh-plus-lifeboat'
const ROUTE_STATUS = '/dsh-plus/lifeboat/status'
const ROUTE_RESTORE = '/dsh-plus/lifeboat/restore'

/** journal kind → 徽标语义色。 */
const KIND_STYLES: Record<string, string> = {
  alert: 'dlb-kindAlert',
  quarantine: 'dlb-kindQuarantine',
  'quarantine-restore': 'dlb-kindRestore',
  'llm-fallback': 'dlb-kindFallback',
  'llm-fallback-revert': 'dlb-kindRestore',
}

const zhDict = {
  tab: '救生艇',
  fallbackActive: 'LLM 应急翻译进行中',
  fallbackFrom: '源路由',
  fallbackTo: '临时路由',
  fallbackAt: '启用时间',
  quarantined: '已隔离插件',
  restore: '恢复',
  restoring: '恢复中…',
  restoreConfirm: '确认恢复该插件？将移除用户 patch 层的禁用覆盖，热应用即时生效。',
  journalTitle: '操作日志',
  pluginsTitle: 'dsh-plus 插件状态',
  pluginFailed: 'FAILED',
  pluginOk: '正常',
  pluginDisabled: '已禁用',
  emptyJournal: '暂无记录。',
  emptyQuarantined: '当前无隔离插件。',
  loadFailed: '状态加载失败：',
  retry: '重试',
  restored: '已恢复，热应用即时生效。',
  restoreFailed: '恢复失败：',
}

const enDict = {
  tab: 'Lifeboat',
  fallbackActive: 'LLM emergency translation active',
  fallbackFrom: 'Source route',
  fallbackTo: 'Fallback route',
  fallbackAt: 'Since',
  quarantined: 'Quarantined plugins',
  restore: 'Restore',
  restoring: 'Restoring…',
  restoreConfirm:
    'Restore this plugin? The disable override in the user patch layer will be removed and hot-applied.',
  journalTitle: 'Journal',
  pluginsTitle: 'dsh-plus plugin status',
  pluginFailed: 'FAILED',
  pluginOk: 'OK',
  pluginDisabled: 'Disabled',
  emptyJournal: 'No entries yet.',
  emptyQuarantined: 'No quarantined plugins.',
  loadFailed: 'Failed to load: ',
  retry: 'Retry',
  restored: 'Restored; hot-applied immediately.',
  restoreFailed: 'Restore failed: ',
}

function HealthTab(props: { t(key: string): string }): ReactElement {
  const { t } = props
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback((): void => {
    getJson<StatusResponse>(ROUTE_STATUS)
      .then((data) => {
        setStatus(data)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onRestore = (name: string): void => {
    setBusyName(name)
    setConfirming(null)
    postJson<{ ok: boolean; error?: string }>(ROUTE_RESTORE, { name })
      .then(() => {
        setNotice(t('restored'))
        load()
      })
      .catch((error: unknown) => {
        setNotice(`${t('restoreFailed')}${error instanceof Error ? error.message : ''}`)
      })
      .finally(() => setBusyName(null))
  }

  const journalGroups = useMemo(() => {
    if (status === null) return []
    const groups = new Map<string, JournalEntry[]>()
    for (const entry of [...status.journal].reverse()) {
      const day = entry.at.slice(0, 10)
      const list = groups.get(day) ?? []
      list.push(entry)
      groups.set(day, list)
    }
    return [...groups.entries()]
  }, [status])

  if (status === null) {
    return (
      <div className="dlb-tab">
        <p className="dlb-empty">{failed ? t('loadFailed') : t('pluginOk') === 'OK' ? '…' : '…'}</p>
        {failed ? (
          <button type="button" className="dlb-btn dlb-btnGhost" onClick={load}>
            {t('retry')}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="dlb-tab">
      {notice !== null ? (
        <p className="dlb-notice" role="status">
          {notice}
        </p>
      ) : null}

      {status.llmFallback?.active === true ? (
        <div className="dlb-fallback" role="status">
          <p className="dlb-fallbackTitle">{t('fallbackActive')}</p>
          <div className="dlb-kv">
            <span>{t('fallbackFrom')}</span>
            <code>
              {status.llmFallback.originalProvider}/{status.llmFallback.originalModel}
            </code>
          </div>
          <div className="dlb-kv">
            <span>{t('fallbackTo')}</span>
            <code>{status.llmFallback.fallbackProvider}</code>
          </div>
          <div className="dlb-kv">
            <span>{t('fallbackAt')}</span>
            <code>{status.llmFallback.at.slice(0, 19).replace('T', ' ')}</code>
          </div>
        </div>
      ) : null}

      <h3 className="dlb-title">{t('quarantined')}</h3>
      {status.quarantined.length === 0 ? (
        <p className="dlb-empty">{t('emptyQuarantined')}</p>
      ) : (
        <div className="dlb-cards">
          {status.quarantined.map((name) => (
            <div className="dlb-quarantineCard" key={name}>
              <code className="dlb-pluginName">{name}</code>
              {confirming === name ? (
                <div className="dlb-confirm">
                  <span className="dlb-confirmText">{t('restoreConfirm')}</span>
                  <button
                    type="button"
                    className="dlb-btn dlb-btnGhost"
                    disabled={busyName === name}
                    onClick={() => setConfirming(null)}
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="dlb-btn dlb-btnPrimary"
                    disabled={busyName === name}
                    onClick={() => onRestore(name)}
                  >
                    {busyName === name ? t('restoring') : t('restore')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="dlb-btn dlb-btnPrimary"
                  disabled={busyName === name}
                  onClick={() => setConfirming(name)}
                >
                  {busyName === name ? t('restoring') : t('restore')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <h3 className="dlb-title">{t('journalTitle')}</h3>
      {journalGroups.length === 0 ? (
        <p className="dlb-empty">{t('emptyJournal')}</p>
      ) : (
        <div className="dlb-journal">
          {journalGroups.map(([day, entries]) => (
            <div className="dlb-journalDay" key={day}>
              <span className="dlb-dayLabel">{day}</span>
              {entries.map((entry) => (
                <div className="dlb-entry" key={`${entry.at}-${entry.kind}`}>
                  <span className={`dlb-kind ${KIND_STYLES[entry.kind] ?? 'dlb-kindInfo'}`}>
                    {entry.kind}
                  </span>
                  <span className="dlb-entryAt">{entry.at.slice(11, 19)}</span>
                  <span className="dlb-entryDetail">{entry.detail}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 挂载健康页（由 client.ts 延迟 require；任何异常由调用方捕获）。 */
export function mountHealthTab(ctx: Context): void {
  const c = ctx as unknown as HealthContext
  const tag = injectHealthStyle()
  c.effect(
    () => () => {
      tag?.remove()
    },
    'lifeboat: health style',
  )
  c.effect(() => c.locale.register(NS, { zh: zhDict, en: enDict }), 'lifeboat: locale')
  const t = c.locale.bind(NS)
  c.slots.inject('settings.plugins.tab', () =>
    c.slots.register(
      {
        name: 'settings.plugins.tab',
        id: 'dsh-plus-lifeboat',
        order: 20,
        label: () => t('tab'),
        inject: () => ({ t }),
      },
      HealthTab,
    ),
  )
}
