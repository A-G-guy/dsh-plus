/**
 * 浏览器半：注入移动端响应式覆盖样式 + 极少量行为胶水（behaviors.ts）。
 * 不注册任何替代组件；上游升级后若选择器失配，仅降级回上游原生表现。
 *
 * 构建产物须为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory
 * （包装见 tsdown.config.ts 的 banner/footer）；style 标签沿用官方
 * data-plugin / data-plugin-css 约定，dsh-client-hmr 据此在热更时卸载。
 * @module @dsh-plus/ui-mobile-fit/client
 */
import type { Context } from '@deepseek-ai/cordis'
import { mobileFitCss } from './styles.ts'
import { installBehaviors } from './behaviors.ts'

export const name = 'dsh-plus-ui-mobile-fit'

const PLUGIN_ID = '@dsh-plus/ui-mobile-fit'
const STYLE_TAG_ID = `${PLUGIN_ID}/styles.css`

function injectStyle(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) {
    return null
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = mobileFitCss
  document.head.appendChild(tag)
  return tag
}

export function apply(ctx: Context): void {
  const tag = injectStyle()
  const disposeBehaviors = typeof document === 'undefined' ? () => {} : installBehaviors()
  ctx.effect(
    () => () => {
      tag?.remove()
      disposeBehaviors()
    },
    'ui-mobile-fit: cleanup',
  )
}
