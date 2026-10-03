/**
 * 配置卡片样式：基础规则走 @dsh-plus/shared/client 的 cardCss('dsm')，
 * 本文件只补插件特有规则（provider 行块 / banner / 目录空态）。
 * 沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载）。
 * @module subagent-model/client/styles
 */
import { cardCss, injectCardStyle } from '@dsh-plus/shared/client'

export const PLUGIN_ID = '@dsh-plus/subagent-model'

const extraCss = `
.dsm-row{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;margin:12px 0 0;padding:4px 12px 10px}
.dsm-rowHead{align-items:center;gap:8px;padding:8px 0 2px;display:flex}
.dsm-rowName{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;line-height:1.5}
.dsm-rowHint{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:12px;line-height:1.5}
.dsm-banner{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:center;gap:8px;border-radius:8px;margin-top:12px;padding:7px 8px;font-size:12px;line-height:18px;display:flex}
.dsm-bannerRetry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}
.dsm-empty{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
/* 分节形态（插件页 page 视图）：provider 行块改为分隔线分组，去掉第二层内边距，
   移动端可用宽度不再被卡片与行块两级内边距同时扣减。 */
.dsm-section .dsm-row{background:0 0;border:0;border-top:1px solid var(--dsw-alias-border-l2);border-radius:0;margin:0;padding:10px 0 2px}
.dsm-section .dsm-row:first-of-type{border-top:0}
@media (max-width:767px){
.dsm-row{padding:2px 8px 8px}
.dsm-rowHead{flex-wrap:wrap}
.dsm-section .dsm-row{padding:10px 0 2px}
}
`

export const cardCssAll = cardCss('dsm', extraCss)

/** 幂等注入样式标签；返回标签（已存在或环境无 document 时为 null）。 */
export function injectStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, cardCssAll)
}
