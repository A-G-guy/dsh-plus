/**
 * 覆盖样式汇总：按层拼装为单一 CSS 文本，由 client.ts 注入。
 * @module @dsh-plus/ui-mobile-fit/styles
 */
import { baseCss } from './styles/base.ts'
import { layoutCss } from './styles/layout.ts'
import { conversationCss } from './styles/conversation.ts'
import { overlaysCss } from './styles/overlays.ts'

export const mobileFitCss: string = [baseCss, layoutCss, conversationCss, overlaysCss].join('\n')
