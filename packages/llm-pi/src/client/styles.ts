/**
 * 配置卡片样式：基础规则走 @dsh-plus/shared/client 的 cardCss('lpc')，
 * 本文件补插件特有规则（route/model 折叠块、目录浏览器行、键值对行、网格、
 * JSON 文本框）及窄屏响应式：views 的双列网格在窄屏转单列、route 头部按钮换行、
 * 键值对行纵向堆叠、文本框 16px 防 iOS 缩放、目录结果区限高滚动。
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
.lpc-chevron{flex:none;transition:transform .18s}
.lpc-chevronOpen{transform:rotate(180deg)}
.lpc-iconBtn{appearance:none;border:none;background:0 0;cursor:pointer;color:var(--dsw-alias-label-tertiary);border-radius:6px;padding:4px;display:inline-flex;flex:none}
.lpc-iconBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.lpc-iconBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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
.lpc-modelHead{display:flex;align-items:center;gap:8px;padding:8px 0}
.lpc-modelTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;flex:none}
.lpc-modelRow .lpc-modelHead .lpc-routeToggle{flex:1}
.lpc-modelBody{border-top:1px dashed var(--dsw-alias-border-l2);padding-bottom:8px}
.lpc-collapse{border-top:1px solid var(--dsw-alias-border-l2);margin:2px 0}
.lpc-collapseHead{appearance:none;background:0 0;border:0;font:inherit;color:inherit;cursor:pointer;display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:10px 0;border-radius:6px}
.lpc-collapseHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.lpc-collapseTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.lpc-collapseMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none;white-space:nowrap}
.lpc-collapseBody{border-top:1px dashed var(--dsw-alias-border-l2);padding-bottom:6px}
.lpc-cat{display:flex;flex-direction:column;gap:6px}
.lpc-catBar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0}
.lpc-catLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;flex:none}
.lpc-catSearch{flex:1;min-width:180px}
.lpc-catSelect{width:auto;max-width:260px;height:30px}
.lpc-catNote{color:var(--dsw-alias-label-tertiary);font-size:12px;min-width:0;word-break:break-all}
.lpc-catSummary{color:var(--dsw-alias-label-secondary);margin:2px 0;font-size:12px}
.lpc-catList{display:flex;flex-direction:column;max-height:420px;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}
.lpc-catRow{border-bottom:1px solid var(--dsw-alias-border-l2);padding:8px 10px}
.lpc-catRow:last-child{border-bottom:none}
.lpc-catHead{display:flex;align-items:center;gap:8px;min-width:0}
.lpc-catPath{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lpc-catName{color:var(--dsw-alias-label-secondary);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lpc-catParams{color:var(--dsw-alias-label-tertiary);margin:2px 0;font-size:12px;line-height:1.6;word-break:break-all}
.lpc-catDetailsToggle{appearance:none;background:0 0;border:0;font:inherit;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;border-radius:6px}
.lpc-catDetailsToggle:hover{color:var(--dsw-alias-label-primary)}
.lpc-catDetailsToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.lpc-catDetails{padding:2px 0 4px}
.lpc-catDetailLabel{color:var(--dsw-alias-label-secondary);margin:6px 0 2px;font-size:12px;font-weight:600}
.lpc-catJson{background:var(--dsw-alias-bg-module-platform);border-radius:8px;color:var(--dsw-alias-label-secondary);margin:0;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.lpc-catMore{padding:6px 0}
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
.lpc-catBar .lpc-input{flex:1;min-width:140px}
.lpc-catSelect{max-width:none}
.lpc-catHead{flex-wrap:wrap}
.lpc-catPath{white-space:normal;word-break:break-all}
.lpc-catName{flex-basis:100%;white-space:normal}
.lpc-catList{max-height:60vh}
}
`

export const cardCssAll = cardCss('lpc', extraCss)

/** 幂等注入样式标签；返回标签（已存在或环境无 document 时为 null）。 */
export function injectStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, cardCssAll)
}
