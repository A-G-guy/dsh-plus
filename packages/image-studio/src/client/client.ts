/**
 * 浏览器半入口（本次预留空壳，不做界面设计与编码）：
 * - 注册独立设置页占位（settings.section），声明画廊/生图页后续挂载点；
 * - 注册 settings.plugin.item 配置卡片占位（key = settings 命名空间）。
 * 数据通道与插槽契约见 docs/README.md「前端接入点」。
 * @module @dsh-plus/image-studio/client
 */
import type { Context } from '@deepseek-ai/cordis'
import { StudioConfigCard } from './card.tsx'
import { en, NS, zh } from './i18n.ts'
import { StudioSection } from './section.tsx'
import { injectCardStyles, injectSectionStyle } from './styles.ts'

export const name = 'dsh-plus-image-studio'

/** 浏览器半需要的 cordis 服务 key（loader 据此注入）。 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings'] as const

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
  const sectionTag = injectSectionStyle()
  const cardTag = injectCardStyles()
  c.effect(
    () => () => {
      sectionTag?.remove()
      cardTag?.remove()
    },
    'image-studio: style',
  )
  c.effect(() => c.locale.register(NS, { zh, en }), 'image-studio: locale')
  const t = c.locale.bind(NS)

  // 独立设置页占位（画廊 + 生图工作台后续版本替换占位组件）。
  c.slots.inject('settings.section', () =>
    c.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-plus-image-studio',
        order: 16,
        label: () => t('nav'),
        inject: () => ({ t }),
      },
      StudioSection,
    ),
  )

  // 配置卡片占位（settings.plugin.item：keyed 槽位，key = settings 命名空间）。
  c.slots.inject('settings.plugin.item', () =>
    c.slots.register(
      {
        name: 'settings.plugin.item',
        key: 'dsh-plus-image-studio',
        locale: NS,
        inject: () => ({ t }),
      },
      StudioConfigCard,
    ),
  )
}
