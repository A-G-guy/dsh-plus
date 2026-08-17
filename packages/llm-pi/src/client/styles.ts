/**
 * 配置卡片样式：沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载），
 * 视觉对齐官方卡片（--dsw-alias-* 变量），不覆盖上游任何选择器。
 * @module llm-pi/client/styles
 */

export const PLUGIN_ID = '@dsh-plus/llm-pi'
export const STYLE_TAG_ID = `${PLUGIN_ID}/card.css`

export const cardCss = `
.lpc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.lpc-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.lpc-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.lpc-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.lpc-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.lpc-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.lpc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.lpc-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.lpc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:12px}
.lpc-chevronOpen{transform:rotate(180deg)}
.lpc-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.lpc-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.lpc-field{flex-direction:column;gap:6px;padding:12px 0;display:flex;min-width:0}
.lpc-field+.lpc-field{border-top:1px solid var(--dsw-alias-border-l2)}
.lpc-head{align-items:center;gap:8px;display:flex}
.lpc-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.lpc-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;width:100%;box-sizing:border-box;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px}
.lpc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.lpc-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.lpc-inputInvalid{border-color:var(--dsw-alias-label-error)}
.lpc-select{appearance:none}
.lpc-textarea{height:auto;min-height:72px;padding:8px 12px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;resize:vertical}
.lpc-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.lpc-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.lpc-checkRow{align-items:center;gap:8px;display:flex;padding:3px 0}
.lpc-checkRow input{accent-color:var(--dsw-alias-brand-primary)}
.lpc-checkRow label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;cursor:pointer}
.lpc-groupLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;padding:14px 0 2px;margin:0}
.lpc-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.lpc-statusRow{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px;line-height:1.6;word-break:break-all}
.lpc-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex;flex-wrap:wrap}
.lpc-status{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;margin:0;font-size:12px;line-height:1.5}
.lpc-statusError{color:var(--dsw-alias-label-error)}
.lpc-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;flex:none}
.lpc-btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.lpc-btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.lpc-btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.lpc-btn:disabled{opacity:.4;cursor:default}
.lpc-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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
`

/** 幂等注入样式标签；返回标签（已存在或环境无 document 时为 null）。 */
export function injectStyle(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) {
    return null
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = cardCss
  document.head.appendChild(tag)
  return tag
}
