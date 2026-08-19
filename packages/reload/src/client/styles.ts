/**
 * 重新加载设置行样式：沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载），
 * 视觉对齐官方偏好行与遮罩（--dsw-alias-* 变量），不覆盖上游任何选择器。
 * @module reload/client/styles
 */

export const PLUGIN_ID = '@dsh-plus/reload'
export const STYLE_TAG_ID = `${PLUGIN_ID}/row.css`

export const rowCss = `
.drl-group{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:16px 0;display:flex}
.drl-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.drl-row{align-items:center;gap:12px;display:flex;flex-wrap:wrap}
.drl-description{color:var(--dsw-alias-label-tertiary);flex:1;min-width:200px;margin:0;font-size:13px;line-height:1.5}
.drl-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:0 0}
.drl-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.drl-btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:#0000}
.drl-btnDanger{background:var(--dsw-alias-label-error);color:#fff;border-color:#0000}
.drl-btn:disabled{opacity:.4;cursor:default}
.drl-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.drl-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);align-items:center;justify-content:center;display:flex}
.drl-dialog{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:28px 32px;max-width:420px;width:calc(100% - 48px);flex-direction:column;gap:12px;display:flex}
.drl-dialogTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:600;line-height:1.4}
.drl-count{color:var(--dsw-alias-label-primary);font-size:44px;font-weight:600;line-height:1;text-align:center;padding:8px 0}
.drl-text{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:1.6}
.drl-warning{color:var(--dsw-alias-label-error);margin:0;font-size:13px;line-height:1.6}
.drl-reasons{color:var(--dsw-alias-label-tertiary);margin:0;padding-left:18px;font-size:12px;line-height:1.7}
.drl-actions{justify-content:flex-end;gap:8px;display:flex;flex-wrap:wrap;padding-top:4px}
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
  tag.textContent = rowCss
  document.head.appendChild(tag)
  return tag
}
