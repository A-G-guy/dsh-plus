/**
 * 配置卡片样式：基础规则走 @dsh-plus/shared/client 的 cardCss('lpc')，
 * 本文件补插件特有规则（route/model 折叠块、键值对行、网格、JSON 文本框）
 * 及窄屏响应式：views 的双列网格在窄屏转单列、route 头部按钮换行、
 * 键值对行纵向堆叠、文本框 16px 防 iOS 缩放。
 * 沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载）。
 * @module llm-pi/client/styles
 */
import { cardCss, injectCardStyle } from '@dsh-plus/shared/client'

export const PLUGIN_ID = '@dsh-plus/llm-pi'

const extraCss = `
.lpc-input{width:100%;box-sizing:border-box}
.lpc-select{appearance:none;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-secondary) 50%),linear-gradient(135deg,var(--dsw-alias-label-secondary) 50%,transparent 50%);background-position:calc(100% - 16px) 50%,calc(100% - 11px) 50%;background-size:5px 5px;background-repeat:no-repeat;padding-right:30px}
.lpc-textarea{height:auto;min-height:72px;padding:8px 12px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;resize:vertical}
.lpc-checkRow{padding:3px 0}
.lpc-statusRow{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px;line-height:1.6;word-break:break-all}
.lpc-btn{flex:none}
.lpc-btnSmall{padding:2px 10px;font-size:12px}
.lpc-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.lpc-gridNested{margin-top:2px}
.lpc-wide{grid-column:1 / -1}
.lpc-addRoute{display:flex;gap:8px;align-items:center;padding:10px 0}
.lpc-addRoute .lpc-input{flex:1;min-width:0}
.lpc-route{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin:10px 0;background:var(--dsw-alias-bg-layer-3)}
.lpc-routeHead{display:flex;align-items:center;gap:8px;padding:6px 10px}
.lpc-routeToggle{appearance:none;background:0 0;border:0;font:inherit;color:inherit;cursor:pointer;display:flex;align-items:center;gap:8px;flex:1;min-width:0;text-align:left;padding:4px 0;border-radius:6px}
.lpc-routeToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.lpc-routeKey{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lpc-routeApi{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lpc-routeBody{border-top:1px solid var(--dsw-alias-border-l2);margin:0 14px;padding-bottom:6px}
.lpc-kvRow{display:flex;gap:8px;align-items:center}
.lpc-kvRow .lpc-input{flex:1;min-width:0}
.lpc-kvAdd{padding-top:8px}
.lpc-modelRow{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;margin:10px 0;padding:0 14px;background:var(--dsw-alias-bg-layer-3)}
.lpc-modelHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0}
.lpc-modelTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.lpc-catalogBar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0}
.lpc-catalogLabel{color:var(--dsw-alias-label-tertiary);font-size:12px}
.lpc-catalogSelect{width:auto;height:30px}
.lpc-collapse{border-top:1px solid var(--dsw-alias-border-l2);margin:2px 0}
.lpc-collapseHead{appearance:none;background:0 0;border:0;font:inherit;color:inherit;cursor:pointer;display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:10px 0;border-radius:6px}
.lpc-collapseHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.lpc-collapseTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.lpc-collapseBody{border-top:1px dashed var(--dsw-alias-border-l2);padding-bottom:6px}
.lpc-refreshBtn{margin-left:8px;vertical-align:middle}
@media (max-width:767px){
.lpc-grid{grid-template-columns:1fr}
.lpc-routeHead{flex-wrap:wrap}
.lpc-routeKey{white-space:normal;word-break:break-all}
.lpc-routeBody{margin:0 8px}
.lpc-modelRow{padding:0 8px}
.lpc-modelHead{flex-wrap:wrap}
.lpc-kvRow{flex-direction:column;align-items:stretch}
.lpc-kvRow .lpc-btn{align-self:flex-end}
.lpc-textarea{font-size:16px}
.lpc-statusRow{display:flex;flex-direction:column;gap:4px}
.lpc-catalogBar .lpc-input{flex:1;min-width:140px}
}
`

export const cardCssAll = cardCss('lpc', extraCss)

/** 幂等注入样式标签；返回标签（已存在或环境无 document 时为 null）。 */
export function injectStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, cardCssAll)
}
