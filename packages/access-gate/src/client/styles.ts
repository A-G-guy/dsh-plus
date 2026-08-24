/**
 * 配置卡片样式：基础规则走 @dsh-plus/shared/client 的 cardCss('dag')，
 * 本文件只补插件特有规则（textarea / 诊断面板 / 警示条）。
 * 沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载）。
 * @module access-gate/client/styles
 */
import { cardCss, injectCardStyle } from '@dsh-plus/shared/client'

export const PLUGIN_ID = '@dsh-plus/access-gate'

const extraCss = `
.dag-textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.6;min-height:96px;resize:vertical;font-family:var(--dsw-alias-font-mono,ui-monospace,monospace)}
.dag-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dag-textarea:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dag-diag{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;margin:12px 0 0;flex-direction:column;gap:4px;display:flex}
.dag-diagTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;margin:0}
.dag-diagRow{display:flex;gap:8px;font-size:12px;line-height:1.6}
.dag-diagKey{color:var(--dsw-alias-label-tertiary);flex:none;min-width:72px}
.dag-diagVal{color:var(--dsw-alias-label-primary);margin:0}
.dag-diagWarn{color:var(--dsw-alias-label-error);border-color:var(--dsw-alias-label-error)}
.dag-warn{color:var(--dsh-plus-warn,#c9503f);border:1px solid var(--dsh-plus-warn-border,rgba(201,80,63,.4));border-radius:8px;padding:8px 12px;margin:12px 0 0;font-size:12px;line-height:1.6}
@media (max-width:767px){
.dag-diagRow{flex-direction:column;gap:2px}
.dag-diagKey{min-width:0}
.dag-textarea{font-size:16px}
}
`

export const cardCssAll = cardCss('dag', extraCss)

/** 幂等注入样式标签；返回标签（已存在或环境无 document 时为 null）。 */
export function injectStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, cardCssAll)
}
