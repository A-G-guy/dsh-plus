/**
 * 浏览器半入口：
 * - settings.section 官方插槽注册「环境变量」独立设置页
 *   （全局管理 + 继承变量屏蔽 + 会话变量管理）；
 * - conversation.input.overlay 注册两个 session 作用域浮层：
 *   `$` 触发补全菜单与 /var 命令唤起的会话变量面板；
 * - commandUi 注册 /var 斜杠命令（官方 popupSelect 壳 → 打开总线 → 面板）。
 * 数据均经同源 HTTP 端点（值不上行经任何对话通道）。
 * @module @dsh-plus/secret-env/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { registerVarCommand } from './command.ts'
import { en, NS, zh } from './i18n.ts'
import { SecretMenu, type TokenSpanLike } from './menu.tsx'
import { SessionPanelHost } from './panel-host.tsx'
import { SecretsSection, type SessionsListLike } from './section.tsx'
import { injectSecretEnvStyle } from './styles.ts'

export const name = 'dsh-plus-secret-env'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale', 'sessions'] as const

interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

/** 会话作用域句柄的结构子集（dsh-api-session-controller 客户端 sessions 服务）。 */
interface SessionScopeLike {
  bail(subject: unknown, event: string, payload: Record<string, unknown>): unknown
}

interface SessionsLike extends SessionsListLike {
  scope(sessionId: string): SessionScopeLike | undefined
  subagentAddress?(sessionId: string): unknown
}

interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
  sessions: SessionsLike
  inject(keys: readonly string[], callback: (scope: never) => void): unknown
  effect(execute: () => () => void, label?: string): unknown
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const styleTag = injectSecretEnvStyle('@dsh-plus/secret-env')
  c.effect(
    () => () => {
      styleTag?.remove()
    },
    'secret-env: style',
  )
  c.effect(() => c.locale.register(NS, { zh, en }), 'secret-env: locale')

  const t = c.locale.bind(NS)
  // 独立设置页（settings.section：官方设置导航；order 16 排在用量统计之后）。
  c.slots.inject('settings.section', () =>
    c.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-plus-secret-env',
        order: 16,
        label: () => t('nav'),
        inject: () => ({ t, sessions: c.sessions }),
      },
      SecretsSection,
    ),
  )

  // `/var` 斜杠命令（commandUi 由 dsh-client-ui-commands 客户端半提供）。
  registerVarCommand(c, c.sessions, t)

  // `$` 触发补全菜单（conversation.input.overlay：composer 卡片内浮层）。
  // 插入走官方会话作用域 bail 通道 slash/input-insert-text（span+draftRev CAS）。
  c.slots.inject('conversation.input.overlay', () =>
    c.slots.register(
      {
        name: 'conversation.input.overlay',
        id: 'dse-secret-menu',
        order: 10,
        locale: NS,
        inject: (sessionId: string) => ({
          sessionId,
          insertToken: (text: string, span: TokenSpanLike): boolean => {
            const actx = c.sessions.scope(sessionId)
            if (actx === undefined) return false
            return (
              actx.bail(actx, 'slash/input-insert-text', {
                text,
                span: { start: span.start, end: span.end, draftRev: span.draftRev },
              }) === true
            )
          },
        }),
      },
      SecretMenu,
    ),
  )

  // `/var` 唤起的会话变量面板（同一 overlay 槽，监听打开总线）。
  c.slots.inject('conversation.input.overlay', () =>
    c.slots.register(
      {
        name: 'conversation.input.overlay',
        id: 'dse-secret-panel',
        order: 20,
        locale: NS,
        inject: (sessionId: string) => ({ sessionId }),
      },
      SessionPanelHost,
    ),
  )
}
