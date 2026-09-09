/**
 * 独立设置页占位组件：本次交付为空壳（不做前端设计与编码）。
 * 后续版本在此渲染生图工作台与画廊；插槽契约已按官方 settings.section 形态声明。
 * @module image-studio/client/section
 */

/** 占位组件（props 形态对齐 settings.section 四 share 注入）。 */
export function StudioSection(props: { t?: (key: string) => string }): unknown {
  const t = props.t ?? ((key: string) => key)
  const el = document.createElement('div')
  el.className = 'dsh-plus-image-studio-section-placeholder'
  el.textContent = t('placeholder')
  return { type: el, props: {} }
}
