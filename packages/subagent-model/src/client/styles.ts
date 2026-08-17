/**
 * 配置卡片样式：沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载），
 * 视觉对齐官方卡片（--dsw-alias-* 变量），不覆盖上游任何选择器。
 * @module subagent-model/client/styles
 */

export const PLUGIN_ID = '@dsh-plus/subagent-model'
export const STYLE_TAG_ID = `${PLUGIN_ID}/card.css`

export const cardCss = `
.dsm-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dsm-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsm-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsm-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dsm-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsm-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dsm-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dsm-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dsm-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:12px}
.dsm-chevronOpen{transform:rotate(180deg)}
.dsm-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dsm-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dsm-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.dsm-field+.dsm-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dsm-head{align-items:center;gap:8px;display:flex}
.dsm-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.dsm-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;min-width:0;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 8px;font-size:13px}
.dsm-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dsm-select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsm-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.dsm-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.dsm-checkRow{align-items:center;gap:8px;display:flex;padding:6px 0}
.dsm-checkRow input{accent-color:var(--dsw-alias-brand-primary)}
.dsm-checkRow label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;cursor:pointer}
.dsm-row{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;margin:12px 0 0;padding:4px 12px 10px}
.dsm-rowHead{align-items:center;gap:8px;padding:8px 0 2px;display:flex}
.dsm-rowName{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;line-height:1.5}
.dsm-rowHint{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:12px;line-height:1.5}
.dsm-groupLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;padding:12px 0 2px;margin:0}
.dsm-status{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;margin:0;font-size:12px;line-height:1.5}
.dsm-statusError{color:var(--dsw-alias-label-error)}
.dsm-banner{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:center;gap:8px;border-radius:8px;margin-top:12px;padding:7px 8px;font-size:12px;line-height:18px;display:flex}
.dsm-bannerRetry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}
.dsm-empty{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.dsm-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex;flex-wrap:wrap}
.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dsm-btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsm-btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsm-btn:disabled{opacity:.4;cursor:default}
.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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
