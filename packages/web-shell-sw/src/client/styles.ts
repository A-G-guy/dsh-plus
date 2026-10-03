/**
 * 配置卡片样式：基础规则走 @dsh-plus/shared/client 的 cardCss('wss')，
 * 本文件只补插件特有规则（生效时机/环境说明段落）。
 * 沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载）。
 * @module web-shell-sw/client/styles
 */
import { cardCss, injectCardStyle } from '@dsh-plus/shared/client'

export const PLUGIN_ID = '@dsh-plus/web-shell-sw'

const extraCss = `
.wss-note{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:12px;line-height:1.5}
`

export const cardCssAll = cardCss('wss', extraCss)

/** 幂等注入样式标签；返回标签（已存在或环境无 document 时为 null）。 */
export function injectStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, cardCssAll)
}
