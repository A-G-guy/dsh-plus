/**
 * 配置卡片样式：沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载），
 * 视觉对齐官方卡片（--dsw-alias-* 变量），不覆盖上游任何选择器。
 * @module notify-email/client/styles
 */

export const PLUGIN_ID = '@dsh-plus/notify-email'
export const STYLE_TAG_ID = `${PLUGIN_ID}/card.css`

export const cardCss = `
.dne-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dne-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dne-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dne-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dne-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dne-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dne-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dne-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dne-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:12px}
.dne-chevronOpen{transform:rotate(180deg)}
.dne-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dne-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dne-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.dne-field+.dne-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dne-head{align-items:center;gap:8px;display:flex}
.dne-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.dne-badge{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dne-badgeSet{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dne-badgeUnset{color:var(--dsw-alias-label-tertiary)}
.dne-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px}
.dne-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dne-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dne-inputInvalid{border-color:var(--dsw-alias-label-error)}
.dne-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.dne-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.dne-checkRow{align-items:center;gap:8px;display:flex;padding:6px 0}
.dne-checkRow input{accent-color:var(--dsw-alias-brand-primary)}
.dne-checkRow label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;cursor:pointer}
.dne-groupLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;padding:12px 0 2px;margin:0}
.dne-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.dne-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex;flex-wrap:wrap}
.dne-status{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;margin:0;font-size:12px;line-height:1.5}
.dne-statusError{color:var(--dsw-alias-label-error)}
.dne-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dne-btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dne-btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dne-btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dne-btn:disabled{opacity:.4;cursor:default}
.dne-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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
