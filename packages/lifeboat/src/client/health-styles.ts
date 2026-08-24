/**
 * 健康页样式：视觉对齐官方设置页（--dsw-alias-*），响应式同套件约定
 * （≤767px 堆叠、44px 热区）。
 * @module lifeboat/client/health-styles
 */
import { injectCardStyle } from '@dsh-plus/shared/client'

export const PLUGIN_ID = '@dsh-plus/lifeboat'

export const healthCss = `
.dlb-tab{display:flex;flex-direction:column;gap:14px;min-width:0}
.dlb-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;margin:4px 0}
.dlb-title{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;margin:10px 0 0}
.dlb-notice{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}
.dlb-fallback{border:1px solid var(--dsw-alias-label-warning,#e0a03c);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-3)}
.dlb-fallbackTitle{color:var(--dsw-alias-label-warning,#e0a03c);font-size:13px;font-weight:600;margin:0}
.dlb-kv{display:flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap}
.dlb-kv span{color:var(--dsw-alias-label-tertiary);flex:none}
.dlb-kv code{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
.dlb-cards{display:flex;flex-direction:column;gap:8px}
.dlb-quarantineCard{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--dsw-alias-bg-layer-3)}
.dlb-pluginName{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;flex:1;min-width:0;word-break:break-all}
.dlb-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-basis:100%}
.dlb-confirmText{color:var(--dsw-alias-label-secondary);font-size:12px;flex:1;min-width:160px;line-height:1.5}
.dlb-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;flex:none}
.dlb-btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dlb-btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dlb-btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dlb-btn:disabled{opacity:.4;cursor:default}
.dlb-journal{display:flex;flex-direction:column;gap:10px}
.dlb-journalDay{display:flex;flex-direction:column;gap:2px}
.dlb-dayLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;margin-bottom:2px}
.dlb-entry{display:flex;align-items:baseline;gap:8px;font-size:12px;line-height:1.6;flex-wrap:wrap}
.dlb-kind{flex:none;border-radius:999px;padding:0 8px;font-size:10px;font-weight:600;line-height:17px;white-space:nowrap}
.dlb-kindInfo{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dlb-kindAlert{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base)}
.dlb-kindQuarantine{background:var(--dsw-alias-label-warning,#e0a03c);color:var(--dsw-alias-bg-base)}
.dlb-kindRestore{background:var(--dsw-alias-state-success,#3d9a50);color:var(--dsw-alias-bg-base)}
.dlb-kindFallback{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dlb-entryAt{color:var(--dsw-alias-label-tertiary);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.dlb-entryDetail{color:var(--dsw-alias-label-primary);min-width:0;word-break:break-word;white-space:pre-wrap;flex:1;flex-basis:320px}
@media (max-width:767px){
.dlb-btn{min-height:44px}
.dlb-quarantineCard{flex-direction:column;align-items:stretch}
.dlb-confirm{flex-direction:column;align-items:stretch}
.dlb-entryDetail{flex-basis:100%}
}
`

/** 幂等注入健康页样式标签。 */
export function injectHealthStyle(): HTMLStyleElement | null {
  return injectCardStyle(PLUGIN_ID, healthCss)
}
