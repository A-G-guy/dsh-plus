/**
 * 配置卡片占位组件：本次交付为空壳（不做前端设计与编码）。
 * 后续版本在此渲染三组预设编辑与凭据管理；keyed 槽位契约已声明。
 * @module image-studio/client/card
 */

/** 占位组件。 */
export function StudioConfigCard(props: { t?: (key: string) => string }): unknown {
  const t = props.t ?? ((key: string) => key)
  const el = document.createElement('div')
  el.className = 'dsh-plus-image-studio-card-placeholder'
  el.textContent = t('cardPlaceholder')
  return { type: el, props: {} }
}
