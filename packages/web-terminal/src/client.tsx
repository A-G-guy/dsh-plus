/**
 * 浏览器半入口：侧边栏 footer 入口按钮 + shell.overlay 终端面板 +
 * settings.plugin.item 配置卡片（key = settings 命名空间字面量）。
 * 模式与 web-files/notify-email 一致：CJS factory 产物、data-plugin-css
 * 样式约定、任一环节失配时静默降级。
 * @module @dsh-plus/web-terminal/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import { cardCss, createApiScope, injectCardStyle } from '@dsh-plus/shared/client'
import { useSyncExternalStore } from 'react'

import { en, NS, zh } from './locales.ts'
import { ConfigCard } from './panel/config-card.tsx'
import { IconTerminalOutline16 } from './panel/icons.tsx'
import { TerminalPanel } from './panel/terminal-panel.tsx'
import { createPanelController, type PanelController, type Translate } from './panel/types.ts'
import { webTerminalAllCss } from './styles.ts'

export const name = 'dsh-plus-web-terminal'

/** 客户端 cordis 服务依赖。 */
export const inject = ['slots', 'locale', 'connection'] as const

const PLUGIN_ID = '@dsh-plus/web-terminal'
const STYLE_TAG_ID = `${PLUGIN_ID}/styles.css`

interface SlotsLike {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
  get(key: 'connection'): { api: { settings: Parameters<typeof createApiScope>[0] } }
  get(key: 'remote'): { $on(event: string, listener: (payload?: unknown) => void): () => void }
  on(event: string, listener: () => void): () => void
  effect(execute: () => () => void, label?: string): unknown
}

function injectStyle(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) {
    return null
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = webTerminalAllCss
  document.head.appendChild(tag)
  return tag
}

interface EntryProps {
  terminal: PanelController
  t: Translate
  /** 侧边栏展开态（slot owner 传入）；折叠（rail）时仅渲染圆形图标。 */
  wide?: boolean
}

/** 侧边栏 footer 入口：与原生「设置」入口同款。 */
function TerminalEntryButton({ terminal, t, wide }: EntryProps) {
  const { open } = useSyncExternalStore(terminal.subscribe, terminal.getSnapshot)
  const rail = wide === false
  return (
    <button
      type="button"
      className={rail ? 'wt-entry wt-entry-rail' : 'wt-entry'}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t('entry.label')}
      onClick={() => terminal.toggle()}
    >
      <IconTerminalOutline16 size={rail ? 18 : 16} />
      {!rail && <span className="wt-entry-label">{t('entry.label')}</span>}
    </button>
  )
}

/** shell.overlay 入口：常驻挂载，闭合时 TerminalPanel 内部渲染空。 */
function TerminalOverlayEntry({ terminal, t }: EntryProps) {
  return <TerminalPanel terminal={terminal} t={t} />
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const tag = injectStyle()
  const cardTag = injectCardStyle(PLUGIN_ID, cardCss('wtc'))
  const controller = createPanelController()

  c.effect(() => c.locale.register(NS, { zh, en }), 'web-terminal: locale')
  c.effect(
    () =>
      c.slots.inject('sidebar.footer.action', () =>
        c.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'web-terminal-entry',
            locale: NS,
            inject: () => ({ terminal: controller, t: c.locale.bind(NS) }),
          },
          TerminalEntryButton,
        ),
      ),
    'web-terminal: entry slot',
  )
  c.effect(
    () =>
      c.slots.inject('shell.overlay', () =>
        c.slots.register(
          {
            name: 'shell.overlay',
            id: 'web-terminal-panel',
            locale: NS,
            inject: () => ({ terminal: controller, t: c.locale.bind(NS) }),
          },
          TerminalOverlayEntry,
        ),
      ),
    'web-terminal: overlay slot',
  )
  const api = c.get('connection').api.settings
  const scope = createApiScope(api, 'dsh-plus-web-terminal', c, 'web-terminal: settings scope')
  c.slots.inject('settings.plugin.item', () =>
    c.slots.register(
      {
        name: 'settings.plugin.item',
        key: 'dsh-plus-web-terminal',
        locale: NS,
        inject: () => ({ t: c.locale.bind(NS), scope, api }),
      },
      ConfigCard,
    ),
  )
  c.effect(
    () => () => {
      tag?.remove()
      cardTag?.remove()
    },
    'web-terminal: cleanup',
  )
}
