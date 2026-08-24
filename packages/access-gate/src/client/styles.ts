/**
 * 配置卡片样式：沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载），
 * 视觉对齐官方卡片（--dsw-alias-* 变量），不覆盖上游任何选择器。
 * @module access-gate/client/styles
 */

export const PLUGIN_ID = '@dsh-plus/access-gate'
export const STYLE_TAG_ID = `${PLUGIN_ID}/card.css`

export const cardCss = `
.dag-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dag-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dag-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dag-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dag-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dag-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dag-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dag-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dag-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:12px}
.dag-chevronOpen{transform:rotate(180deg)}
.dag-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dag-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dag-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.dag-field+.dag-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dag-head{align-items:center;gap:8px;display:flex}
.dag-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.dag-badge{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dag-badgeSet{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dag-badgeUnset{color:var(--dsw-alias-label-tertiary)}
.dag-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px}
.dag-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dag-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dag-inputInvalid{border-color:var(--dsw-alias-label-error)}
.dag-textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.6;min-height:96px;resize:vertical;font-family:var(--dsw-alias-font-mono,ui-monospace,monospace)}
.dag-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dag-textarea:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dag-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.dag-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.dag-checkRow{align-items:center;gap:8px;display:flex;padding:6px 0}
.dag-checkRow input{accent-color:var(--dsw-alias-brand-primary)}
.dag-checkRow label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;cursor:pointer}
.dag-groupLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;padding:12px 0 2px;margin:0}
.dag-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.dag-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex;flex-wrap:wrap}
.dag-status{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;margin:0;font-size:12px;line-height:1.5}
.dag-statusError{color:var(--dsw-alias-label-error)}
.dag-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dag-btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dag-btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dag-btnPrimary{background:var(--dsh-plus-brand,#3d6dff);color:#fff}
.dag-btn:disabled{opacity:.4;cursor:default}
.dag-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dag-diag{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;margin:12px 0 0;flex-direction:column;gap:4px;display:flex}
.dag-diagTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin:0}
.dag-diagRow{display:flex;gap:8px;font-size:12px;line-height:1.6}
.dag-diagKey{color:var(--dsw-alias-label-tertiary);flex:none;min-width:72px}
.dag-diagVal{color:var(--dsw-alias-label-primary);margin:0}
.dag-diagWarn{color:var(--dsw-alias-label-error);border-color:var(--dsw-alias-label-error)}
.dag-warn{color:var(--dsh-plus-warn,#c9503f);border:1px solid var(--dsh-plus-warn-border,rgba(201,80,63,.4));border-radius:8px;padding:8px 12px;margin:12px 0 0;font-size:12px;line-height:1.6}
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
  document.head.append(tag)
  return tag
}
