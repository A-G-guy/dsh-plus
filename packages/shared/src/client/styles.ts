/**
 * 配置卡片样式工厂（各插件 client 的公共收编版）。
 * 视觉规则与迁移前逐字一致（类名前缀换为各插件自身，DOM 类名不变），
 * 另补移动端与可达性增强（767px 断点 + pointer:coarse，对齐 ui-mobile-fit 约定）：
 * - 窄屏 input/textarea 16px（防 iOS 聚焦缩放）、可点目标 ≥44px；
 * - footer 按钮等宽换行、状态文字独占一行；
 * - 展开态 body 底部 sticky 保存栏（长表单滚动中始终可达）。
 * 沿用官方 data-plugin / data-plugin-css 约定（HMR 据此卸载），不覆盖上游选择器。
 * @module @dsh-plus/shared/client/styles
 */

/** 生成全套卡片 CSS；prefix 为插件类名前缀（如 'dne'），extra 为插件特有规则。 */
export function cardCss(prefix: string, extra = ''): string {
  return `
.${prefix}-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.${prefix}-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.${prefix}-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.${prefix}-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.${prefix}-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.${prefix}-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.${prefix}-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.${prefix}-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.${prefix}-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;display:inline-flex}
.${prefix}-chevronOpen{transform:rotate(180deg)}
.${prefix}-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.${prefix}-statusBadge{white-space:nowrap;border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.${prefix}-statusOn{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.${prefix}-statusOff{color:var(--dsw-alias-label-tertiary)}
.${prefix}-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.${prefix}-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.${prefix}-field+.${prefix}-field{border-top:1px solid var(--dsw-alias-border-l2)}
.${prefix}-head{align-items:center;gap:8px;display:flex}
.${prefix}-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.${prefix}-badge{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.${prefix}-badgeSet{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.${prefix}-badgeUnset{color:var(--dsw-alias-label-tertiary)}
.${prefix}-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;transition:border-color .18s,background .18s}
.${prefix}-input:hover:not(:disabled):not(:focus-visible){border-color:var(--dsw-alias-label-dimmed)}
.${prefix}-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.${prefix}-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.${prefix}-inputInvalid{border-color:var(--dsw-alias-label-error)}
.${prefix}-select{appearance:none;background:var(--dsw-alias-bg-module-platform);border:none;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-secondary) 50%),linear-gradient(135deg,var(--dsw-alias-label-secondary) 50%,transparent 50%);background-position:calc(100% - 16px) 50%,calc(100% - 11px) 50%;background-size:5px 5px;background-repeat:no-repeat;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;height:34px;box-sizing:border-box;border-radius:8px;padding:0 30px 0 12px;transition:background-color .18s}
.${prefix}-select:hover:not(:disabled){background-color:var(--dsw-alias-interactive-bg-hover)}
.${prefix}-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.${prefix}-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.${prefix}-checkRow{align-items:center;gap:10px;display:flex;padding:6px 0}
.${prefix}-checkRow label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;cursor:pointer;flex:1;min-width:0}
/* 自绘圆角扁平开关（官方 UI 无可见原生 checkbox，选择类全走胶囊/菜单） */
.${prefix}-checkRow input{appearance:none;-webkit-appearance:none;position:relative;box-sizing:border-box;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:999px;width:34px;height:20px;flex:none;cursor:pointer;transition:background .18s;margin:0}
.${prefix}-checkRow input::after{content:"";position:absolute;top:2px;left:2px;background:var(--dsw-alias-label-primary);border-radius:999px;width:16px;height:16px;transition:left .18s cubic-bezier(.4,0,.2,1)}
.${prefix}-checkRow input:checked{background:var(--dsw-alias-brand-primary)}
.${prefix}-checkRow input:checked::after{left:16px;background:var(--dsw-alias-bg-base)}
.${prefix}-checkRow input:disabled{opacity:.4;cursor:default}
.${prefix}-checkRow input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.${prefix}-groupLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;padding:12px 0 2px;margin:0}
.${prefix}-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.${prefix}-warn{color:var(--dsw-alias-label-error);margin:12px 0 0;font-size:12px;line-height:1.5}
.${prefix}-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex;flex-wrap:wrap}
.${prefix}-status{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;margin:0;font-size:12px;line-height:1.5}
.${prefix}-statusError{color:var(--dsw-alias-label-error)}
.${prefix}-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.${prefix}-btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.${prefix}-btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.${prefix}-btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.${prefix}-btn:disabled{opacity:.4;cursor:default}
.${prefix}-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
@media (max-width:767px){
.${prefix}-body{margin:0 10px}
.${prefix}-header{padding:12px 12px}
.${prefix}-input,.${prefix}-select{font-size:16px;height:40px}
.${prefix}-checkRow{min-height:44px;padding:8px 0}
.${prefix}-footer{position:sticky;bottom:0;background:var(--dsw-alias-bg-layer-2);margin:0 -10px;padding:10px 10px 6px;border-top:1px solid var(--dsw-alias-border-l2);border-bottom-left-radius:12px;border-bottom-right-radius:12px}
.${prefix}-status{flex-basis:100%;flex:none}
.${prefix}-btn{min-height:44px;flex:1;min-width:96px}
.${prefix}-statusBadge{display:none}
}
@media (pointer:coarse){
.${prefix}-btn{min-height:44px}
.${prefix}-checkRow{min-height:44px}
.${prefix}-input,.${prefix}-select{height:40px}
}
${extra}
`
}

/**
 * 幂等注入样式标签（官方 data-plugin-css 约定）；返回新标签，
 * 已存在或环境无 document 时返回 null（调用方 effect 卸载用）。
 */
export function injectCardStyle(pluginId: string, css: string): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  const tagId = `${pluginId}/card.css`
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) {
    return null
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = pluginId
  tag.dataset.pluginCss = tagId
  tag.textContent = css
  document.head.appendChild(tag)
  return tag
}
