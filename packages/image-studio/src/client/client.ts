/**
 * 浏览器半入口：
 * - sidebar.footer.action：侧栏底部入口按钮（与文件/终端入口 flex 等分行宽）；
 * - shell.overlay：图像工作室面板（文生图/图生图/画廊 + 任务条）；
 * - settings.plugin.item：配置卡片（三组预设 + 凭据 + 高级项，key = settings 命名空间）。
 * 模式与 web-files/web-terminal 一致：CJS factory 产物、data-plugin-css 样式
 * 约定、slot 失配静默降级；配置读写经 ctx.remote.settings 直连（远程域名可用）。
 * @module @dsh-plus/image-studio/client
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  cardCss,
  createNamespaceApi,
  createSettingsScope,
  injectCardStyle,
  type ScopeHostContext,
} from '@dsh-plus/shared/client'

import { SETTINGS_NS } from '../ns.ts'
import { StudioConfigCard } from './card.tsx'
import { en, NS, type Translate, zh } from './i18n.ts'
import { createPanelController } from './panel/controller.ts'
import { StudioEntryButton } from './panel/entry.tsx'
import { StudioPanel } from './panel/panel.tsx'
import { injectStudioStyles } from './styles.ts'

export const name = 'dsh-plus-image-studio'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入；package.json 的 dsh.client.inject 管包加载顺序）。 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings'] as const

const PLUGIN_ID = '@dsh-plus/image-studio'

interface SlotsLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LocaleLike {
  register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string) => string
}

/** createSettingsScope 要求的宿主窄面 + 本插件用到的 slots/locale 服务。 */
interface ClientContext extends ScopeHostContext {
  slots: SlotsLike
  locale: LocaleLike
}

export function apply(ctx: Context): void {
  const c = ctx as unknown as ClientContext
  const panelTag = injectStudioStyles()
  const cardTag = injectCardStyle(PLUGIN_ID, cardCss('imsc'))
  const controller = createPanelController()
  c.effect(() => c.locale.register(NS, { zh, en }), 'image-studio: locale')
  const t = c.locale.bind(NS) as Translate

  c.effect(
    () =>
      c.slots.inject('sidebar.footer.action', () =>
        c.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'image-studio-entry',
            locale: NS,
            inject: () => ({ studio: controller, t }),
          },
          StudioEntryButton,
        ),
      ),
    'image-studio: entry slot',
  )
  const scope = createSettingsScope(c, SETTINGS_NS, 'image-studio: settings scope')
  const api = createNamespaceApi(c.get('remote').settings, SETTINGS_NS)
  c.effect(
    () =>
      c.slots.inject('shell.overlay', () =>
        c.slots.register(
          {
            name: 'shell.overlay',
            id: 'image-studio-panel',
            locale: NS,
            inject: () => ({ studio: controller, t, scope, api }),
          },
          StudioPanel,
        ),
      ),
    'image-studio: overlay slot',
  )
  c.slots.inject('settings.plugin.item', () =>
    c.slots.register(
      {
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        locale: NS,
        inject: () => ({ t, scope, api }),
      },
      StudioConfigCard,
    ),
  )
  c.effect(
    () => () => {
      panelTag?.remove()
      cardTag?.remove()
    },
    'image-studio: cleanup',
  )
}
