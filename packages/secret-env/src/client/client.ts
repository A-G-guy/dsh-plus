/**
 * 浏览器半入口：
 * - settings.section 官方插槽注册「密钥变量」独立设置页（全局管理）；
 * - conversation.input.right session 作用域插槽注册 composer 钥匙胶囊
 *   （会话级密钥面板；会话 id 由插槽 inject 工厂直接供给）。
 * 数据均经同源 HTTP 端点（值不上行经任何对话通道）。
 * @module @dsh-plus/secret-env/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { ComposerSecret } from './composer.tsx'
import { en, NS, zh } from './i18n.ts'
import { SecretsSection } from './section.tsx'
import { injectSecretEnvStyle } from './styles.ts'

export const name = 'dsh-plus-secret-env'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale'] as const

interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
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
        inject: () => ({ t }),
      },
      SecretsSection,
    ),
  )

  // composer 工具行钥匙胶囊（conversation.input.right：session 作用域 list 槽，
  // inject 工厂收框架解析的 sessionId）。
  c.slots.inject('conversation.input.right', () =>
    c.slots.register(
      {
        name: 'conversation.input.right',
        id: 'dsh-plus-secret-env',
        order: 40,
        locale: NS,
        inject: (sessionId: string) => ({ sessionId }),
      },
      ComposerSecret,
    ),
  )
}
