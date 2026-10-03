/**
 * 配置卡片样式：基础规则走 @dsh-plus/shared/client 的 cardCss('wsv')，
 * 本文件只补插件特有规则（优先级多行文本域、密钥说明块）。
 * 沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载）。
 * @module web-search-services/client/styles
 */
import { cardCss, injectCardStyle } from '@dsh-plus/shared/client'

export const PLUGIN_ID = '@dsh-plus/web-search-services'

const extraCss = `
.wsv-priority{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.6;min-height:72px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wsv-priority:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.wsv-priority:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.wsv-keys{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;margin:12px 0 0;padding:10px 12px}
.wsv-keysTitle{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;font-weight:600}
@media (max-width:767px){
.wsv-priority{font-size:16px}
}
`

export const cardCssAll = cardCss('wsv', extraCss)

/** 幂等注入样式标签；返回标签（已存在或环境无 document 时为 null）。 */
export function injectStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, cardCssAll)
}
