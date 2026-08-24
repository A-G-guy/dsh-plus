/**
 * 用量统计页面样式（section + 价目卡片）。
 * 视觉对齐官方设置页（--dsw-alias-*）；响应式硬要求：
 * ≤767px 模型表转纵向堆叠行、价目网格单列、输入 16px 防 iOS 缩放、按钮 ≥44px。
 * @module usage-panel/client/styles
 */
import { cardCss, injectCardStyle } from '@dsh-plus/shared/client'

export const PLUGIN_ID = '@dsh-plus/usage-panel'

const sectionCss = `
.dup-section{display:flex;flex-direction:column;gap:16px;min-width:0}
.dup-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dup-headText{flex:1;min-width:220px;display:flex;flex-direction:column;gap:4px}
.dup-title{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;margin:0;line-height:1.4}
.dup-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;margin:0;line-height:1.5}
.dup-headActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dup-meta{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dup-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;margin:8px 0}
.dup-ranges{display:flex;gap:6px;flex-wrap:wrap}
.dup-rangeBtn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:5px 12px;font-size:12px;line-height:1.5}
.dup-rangeBtn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dup-rangeActive{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}
.dup-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.dup-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;list-style:none}
.dup-cardLabel{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dup-cardValue{color:var(--dsw-alias-label-primary);font-size:22px;font-weight:600;line-height:1.3}
.dup-cardMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
.dup-groupTitle{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;margin:12px 0 0}
.dup-chart{display:flex;align-items:flex-end;gap:3px;height:120px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:8px 0 0;overflow-x:auto}
.dup-barCol{appearance:none;font:inherit;background:0 0;border:0;padding:0;flex:1;min-width:14px;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;cursor:pointer}
.dup-barCol:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:4px}
.dup-bar{width:70%;max-width:26px;background:var(--dsw-alias-brand-primary);border-radius:3px 3px 0 0;min-height:0;opacity:.55;transition:opacity .15s}
.dup-barCol:hover .dup-bar{opacity:.8}
.dup-barActive .dup-bar{opacity:1}
.dup-barLabel{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.2;white-space:nowrap;min-height:12px}
.dup-table{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.dup-tr{display:grid;grid-template-columns:minmax(160px,2fr) repeat(5,minmax(64px,1fr));gap:0}
.dup-th{background:var(--dsw-alias-bg-module-platform)}
.dup-th .dup-td{color:var(--dsw-alias-label-secondary);font-weight:600;font-size:12px}
.dup-td{padding:8px 12px;color:var(--dsw-alias-label-primary);font-size:12px;display:flex;align-items:center;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-top:1px solid var(--dsw-alias-border-l2)}
.dup-tr:not(.dup-th) .dup-td{border:0}
.dup-tr+.dup-tr .dup-td{border-top:1px solid var(--dsw-alias-border-l2)}
.dup-tdModel{flex-direction:column;align-items:flex-start;gap:2px}
.dup-provider{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dup-model{font-weight:500}
.dup-progress{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px}
.dup-progressText{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.dup-progressBar{flex:1;height:6px;background:var(--dsw-alias-bg-module-platform);border-radius:999px;overflow:hidden}
.dup-progressFill{height:100%;background:var(--dsw-alias-brand-primary);border-radius:999px;transition:width .3s}
/* 单日明细（点击柱状图某天展开） */
.dup-dayDetail{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin-top:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-3);display:flex;flex-direction:column;gap:8px}
.dup-dayHead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dup-dayDate{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.dup-dayMeta{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dup-dayTable .dup-td{padding:6px 10px}
.dup-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;flex:none}
.dup-btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dup-btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dup-btn:disabled{opacity:.4;cursor:default}
.dup-btnSmall{padding:2px 10px;font-size:12px}
.dup-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.dup-priceRow{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;margin:12px 0 0;padding:10px 12px}
.dup-priceHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dup-priceTitle{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dup-priceGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.dup-mini{display:flex;flex-direction:column;gap:4px;min-width:0}
.dup-mini span{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dup-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:13px;width:100%;box-sizing:border-box}
.dup-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dup-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
@media (max-width:767px){
.dup-headActions{width:100%;justify-content:space-between}
.dup-rangeBtn{min-height:44px;flex:1}
.dup-chart{height:96px}
.dup-tr{grid-template-columns:1fr}
.dup-th{display:none}
.dup-tr{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dup-tr .dup-td{justify-content:space-between;border-top:0;padding:6px 12px}
.dup-tr .dup-td::before{content:attr(data-label);color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none;margin-right:12px}
.dup-tdModel{flex-direction:row;align-items:center;padding-top:10px}
.dup-model{overflow:hidden;text-overflow:ellipsis}
.dup-priceGrid{grid-template-columns:1fr}
.dup-input{font-size:16px;height:40px}
.dup-btn{min-height:44px}
.dup-cardValue{font-size:19px}
}
`

const cardExtra = `
/* 价目卡片：字段视觉经 .dup-input（与套件 -input 同款圆角扁平）完全一致 */
.dup-priceRow{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;margin:12px 0 0;padding:10px 12px}
.dup-priceHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dup-priceTitle{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dup-priceGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.dup-mini{display:flex;flex-direction:column;gap:4px;min-width:0}
.dup-mini span{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dup-in{width:100%;box-sizing:border-box;height:30px;padding:0 10px;font-size:12px}
@media (max-width:767px){
.dup-priceGrid{grid-template-columns:1fr}
.dup-in{font-size:16px;height:40px}
}
`

export const sectionCssAll = sectionCss
export const cardCssAll = cardCss('dup', cardExtra)

/** 幂等注入样式标签（section 与卡片同一插件标签，id 不同）。 */
export function injectSectionStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, sectionCssAll)
}

export function injectCardStyles(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  const tagId = `${PLUGIN_ID}/card.css`
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) {
    return null
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = tagId
  tag.textContent = cardCssAll
  document.head.appendChild(tag)
  return tag
}
