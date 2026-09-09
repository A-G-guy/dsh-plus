/**
 * 画廊/生图占位样式：本次交付仅注入极简占位类名（无视觉设计）。
 * 沿用官方约定 <style data-plugin data-plugin-css>，HMR 按此卸载。
 * @module image-studio/client/styles
 */

const PKG = '@dsh-plus/image-studio'

/** 注入设置页占位样式。 */
export function injectSectionStyle(): HTMLStyleElement | null {
  return inject(
    'dsh-plus-image-studio-section',
    '.dsh-plus-image-studio-section-placeholder{padding:16px;opacity:.6}',
  )
}

/** 注入配置卡片占位样式。 */
export function injectCardStyles(): HTMLStyleElement | null {
  return inject(
    'dsh-plus-image-studio-card',
    '.dsh-plus-image-studio-card-placeholder{padding:8px;opacity:.6}',
  )
}

function inject(id: string, css: string): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  const tag = document.createElement('style')
  tag.dataset.plugin = PKG
  tag.dataset.pluginCss = `${PKG}/${id}`
  tag.textContent = css
  document.head.appendChild(tag)
  return tag
}
