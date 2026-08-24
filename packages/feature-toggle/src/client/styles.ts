/**
 * 配置卡片样式：沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载），
 * 视觉对齐官方卡片（--dsw-alias-* 变量），不覆盖上游任何选择器。
 * @module feature-toggle/client/styles
 */

export const PLUGIN_ID = '@dsh-plus/feature-toggle'
export const STYLE_TAG_ID = `${PLUGIN_ID}/card.css`

export const cardCss = `
.dft-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dft-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dft-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dft-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dft-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dft-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dft-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dft-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dft-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:12px}
.dft-chevronOpen{transform:rotate(180deg)}
.dft-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dft-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dft-banner{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border-radius:8px;margin:12px 0 0;padding:8px 12px;font-size:12px;line-height:1.6}
.dft-bannerWarn{color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-label-dimmed)}
.dft-bannerError{color:var(--dsw-alias-label-error);border:1px solid var(--dsw-alias-label-error)}
.dft-groupLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;padding:12px 0 2px;margin:0}
.dft-row{align-items:center;gap:12px;padding:10px 0;display:flex;border-top:1px solid var(--dsw-alias-border-l2)}
.dft-row:first-of-type{border-top:0}
.dft-rowText{flex-direction:column;gap:2px;min-width:0;flex:1;display:flex}
.dft-rowTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}
.dft-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.dft-rowEffect{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
.dft-chip{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);flex:none}
.dft-chipPending{color:var(--dsw-alias-label-error);border:1px solid var(--dsw-alias-label-dimmed);background:0 0}
.dft-check{accent-color:var(--dsw-alias-brand-primary);flex:none;width:16px;height:16px;cursor:pointer}
.dft-check:disabled{cursor:default}
.dft-presetBox{border-top:1px solid var(--dsw-alias-border-l2);padding-top:4px;margin-top:12px}
.dft-journalBox{border-top:1px solid var(--dsw-alias-border-l2);padding-top:4px;margin-top:12px}
.dft-journal{list-style:none;margin:0;padding:0;max-height:180px;overflow-y:auto}
.dft-journalEntry{align-items:baseline;gap:8px;padding:4px 0;display:flex}
.dft-journalKind{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;flex:none;min-width:56px}
.dft-journalDetail{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;min-width:0}
.dft-hint{color:var(--dsw-alias-label-tertiary);margin:4px 0 8px;font-size:12px;line-height:1.5}
.dft-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.dft-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex;flex-wrap:wrap}
.dft-status{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;margin:0;font-size:12px;line-height:1.5}
.dft-statusError{color:var(--dsw-alias-label-error)}
.dft-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dft-btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dft-btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dft-btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dft-btn:disabled{opacity:.4;cursor:default}
.dft-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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
