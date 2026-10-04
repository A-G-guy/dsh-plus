/**
 * 配置卡片样式：基础规则走 @dsh-plus/shared/client 的 cardCss('act')，
 * 本文件只补插件特有规则（说明段落与代码片段）。
 * 沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载）。
 * @module @dsh-plus/actual/client/styles
 */
import { cardCss, injectCardStyle } from '@dsh-plus/shared/client'

export const PLUGIN_ID = '@dsh-plus/actual'

const extraCss = `
.act-note{margin:14px 0 0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2)}
.act-noteTitle{margin:0 0 6px;font-size:13px;font-weight:600}
.act-noteBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.act-snippet{display:block;margin:8px 0 0;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-mono,monospace);font-size:11px;line-height:1.5;white-space:pre;overflow-x:auto}
`

export const cardCssAll = cardCss('act', extraCss)

/** 幂等注入样式标签；返回标签（已存在或环境无 document 时为 null）。 */
export function injectStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, cardCssAll)
}
