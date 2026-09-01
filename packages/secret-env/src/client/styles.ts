/**
 * 样式注入：shared cardCss('dse') 提供官方卡片/字段/按钮基件，
 * extra 部分为本插件特有规则——设置页变量表（桌面网格、≤767px 堆叠）
 * 与会话注入控件（官方 chip 胶囊 + popover，窄屏转底部抽屉）。
 * @module secret-env/client/styles
 */
import { cardCss, injectCardStyle } from '@dsh-plus/shared/client'

const EXTRA = `
/* 设置页布局 */
.dse-section{padding:0 0 24px}
.dse-head{flex-direction:column;gap:6px;padding:16px 0 12px;display:flex}
.dse-title{color:var(--dsw-alias-label-primary);font-size:18px;font-weight:600;margin:0;line-height:1.4}
.dse-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;margin:0;line-height:1.6}
.dse-groupLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;padding:14px 0 8px;margin:0}
.dse-rows{flex-direction:column;display:flex;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden}
.dse-row{align-items:center;gap:12px;padding:10px 14px;display:flex;background:var(--dsw-alias-bg-layer-3)}
.dse-row+.dse-row{border-top:1px solid var(--dsw-alias-border-l2)}
.dse-rowMain{flex-direction:column;gap:3px;flex:1;min-width:0;display:flex}
.dse-env{align-items:center;gap:6px;display:flex;min-width:0}
.dse-envName{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dse-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dse-badges{align-items:center;gap:6px;flex:none;display:flex}
.dse-badge{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dse-badgeDim{background:0 0;color:var(--dsw-alias-label-tertiary)}
.dse-iconBtn{appearance:none;border:none;background:0 0;cursor:pointer;color:var(--dsw-alias-label-tertiary);border-radius:6px;padding:4px;display:inline-flex}
.dse-iconBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dse-iconBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dse-delBtn{color:var(--dsw-alias-label-tertiary)}
.dse-delBtn:hover{color:var(--dsw-alias-label-error)}
.dse-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:18px 14px;margin:0;background:var(--dsw-alias-bg-layer-3)}
.dse-form{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:4px 14px 12px;margin-top:10px}
.dse-inputError{border-color:var(--dsw-alias-label-error)}
.dse-hintError{color:var(--dsw-alias-label-error)}
/* 会话变量面板（/var 命令唤起，overlay 槽浮层）与内嵌共用件 */
.dse-panelWrap{position:relative}
.dse-panelCard{position:absolute;bottom:calc(100% + 6px);left:0;right:0;z-index:60;max-height:min(60vh,560px);overflow:auto;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:10px 12px 12px}
.dse-maskBtnOn{color:var(--dsw-alias-label-error)}
.dse-envNameDim{opacity:.55;text-decoration:line-through}
.dse-popHead{align-items:center;gap:8px;display:flex;padding:2px 0 8px}
.dse-popTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;flex:1;margin:0}
.dse-popHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0 0 8px}
.dse-popList{flex-direction:column;display:flex;margin:0 -4px;padding:0 4px}
.dse-popList .dse-row{background:0 0;border-radius:8px;padding:8px 8px}
.dse-popList .dse-row+.dse-row{border-top:1px solid var(--dsw-alias-border-l2)}
.dse-popForm{border-top:1px solid var(--dsw-alias-border-l2);margin-top:8px;padding-top:4px}
.dse-foot{justify-content:flex-end;gap:8px;display:flex;padding-top:8px}
.dse-formGrid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
/* $ 触发补全菜单（仿官方 input-trigger MenuView 的浮层语言） */
.dse-menuWrap{position:relative}
.dse-menu{position:absolute;bottom:calc(100% + 6px);left:8px;z-index:60;min-width:280px;max-width:min(420px,calc(100vw - 32px));max-height:320px;overflow:auto;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:4px}
.dse-menuTitle{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;padding:6px 10px 4px}
.dse-menuItem{appearance:none;border:none;background:0 0;cursor:pointer;align-items:center;gap:8px;width:100%;padding:7px 10px;border-radius:8px;display:flex;text-align:left}
.dse-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dse-menuItemActive{background:var(--dsw-alias-interactive-bg-hover)}
.dse-menuName{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);font-size:13px;flex:none}
.dse-menuDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dse-menuBadges{align-items:center;gap:4px;flex:none;display:flex}
@media (max-width:767px){
.dse-menu{left:0;right:0;min-width:0;max-width:none;max-height:45vh}
.dse-menuItem{min-height:44px}
}

@media (max-width:767px){
.dse-formGrid{grid-template-columns:1fr}
.dse-row{flex-wrap:wrap;padding:12px 12px}
.dse-rowMain{flex-basis:100%}
.dse-badges{margin-left:auto}
.dse-panelCard{position:fixed;left:8px;right:8px;bottom:8px;top:auto;max-height:70vh}
}
@media (pointer:coarse){
.dse-iconBtn{min-width:44px;min-height:44px;align-items:center;justify-content:center}
}
`

/** 幂等注入本插件样式；返回新标签（卸载用），已存在或无 document 返回 null。 */
export function injectSecretEnvStyle(pluginId: string): HTMLStyleElement | null {
  return injectCardStyle(pluginId, cardCss('dse', EXTRA))
}
