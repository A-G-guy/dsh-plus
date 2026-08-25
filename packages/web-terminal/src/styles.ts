/**
 * 面板样式：全部颜色引用 --dsw-* 设计令牌（跟随原生深浅色主题），
 * 响应式断点 767px 与 @dsh-plus/ui-mobile-fit 对齐。
 * 构建期内联为字符串，客户端经 data-plugin-css style 标签注入（HMR 可卸载）。
 * xterm 基础结构样式一并注入（见 ./xterm-css.ts）。
 * @module web-terminal/styles
 */
import { xtermCss } from './xterm-css.ts'

export const webTerminalCss = `
/* ── 侧边栏入口（与原生「设置」入口同款）── */
/* flex: 1 1 0 + min-width: 0：footer 横排容纳多个插件入口（终端/文件）时
   等分宽度不溢出；单入口时等同整行。 */
.wt-entry {
  box-sizing: border-box;
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 42px;
  margin: 4px 0;
  padding: 0 10px 0 8px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #1f2328);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  overflow: hidden;
}
.wt-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.wt-entry-rail {
  flex: none;
  width: 36px;
  height: 36px;
  margin: 8px 0 10px;
  padding: 0;
  border-radius: 50%;
  justify-content: center;
  gap: 0;
}
.wt-entry-label {
  white-space: nowrap;
  overflow: hidden;
}

/* ── 模态卡（覆盖 primitives Modal 默认尺寸）── */
.wt-modal {
  width: min(1200px, 94vw) !important;
  max-width: none !important;
  height: min(760px, 88vh);
  padding: 0 !important;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wt-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
  color: var(--dsw-alias-label-primary, #1f2328);
}

/* ── 标签条 ── */
.wt-tabbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  flex: none;
}
.wt-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  flex: 1;
  min-width: 0;
}
.wt-tab {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border-radius: 10px 10px 0 0;
  padding: 6px 4px 6px 10px;
  color: var(--dsw-alias-label-secondary, #57606a);
  max-width: 200px;
}
.wt-tab:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
}
.wt-tab-active {
  background: var(--dsw-alias-interactive-bg-active, rgba(77, 107, 254, 0.12));
  color: var(--dsw-alias-label-primary, #1f2328);
}
.wt-tab-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 13px;
  min-width: 0;
}
.wt-tab-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wt-tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  flex: none;
  opacity: 0.6;
}
.wt-tab-icon:hover {
  opacity: 1;
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
}

/* ── 工具栏 ── */
.wt-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  flex: none;
}
.wt-toolbar-status {
  margin-left: auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
}
.wt-status-warn {
  font-size: 12px;
  color: var(--dsw-alias-state-warn-label, #9a6700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 分屏树 ── */
.wt-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.wt-tree {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.wt-split {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
}
.wt-split-row {
  flex-direction: row;
}
.wt-split-col {
  flex-direction: column;
}
.wt-cell {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  /* 尺寸由内联 flex-basis（布局树比例）决定；grow 会把比例重新抹平，禁用。 */
  flex: 0 1 auto;
}
.wt-gutter {
  flex: none;
  background: var(--dsw-alias-border-l1, #e5e7eb);
  z-index: 1;
}
.wt-gutter-row {
  width: 4px;
  cursor: col-resize;
  margin: 0 1px;
}
.wt-gutter-col {
  height: 4px;
  cursor: row-resize;
  margin: 1px 0;
}
.wt-gutter:hover,
.wt-gutter:active {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
}

/* ── 终端叶 ── */
.wt-leaf {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  outline: 1px solid transparent;
}
.wt-leaf-focus {
  outline-color: var(--dsw-alias-brand-primary, #4d6bfe);
}
.wt-pane-term {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  /* --dsw-alias-bg-base 随深浅色切换（旧名 bg-canvas 上游不存在，曾导致
     深色下回退为纯白底） */
  background: var(--dsw-alias-bg-base, #ffffff);
}
.wt-term-host {
  position: absolute;
  inset: 0;
  padding: 4px 6px;
}
.wt-term-host .xterm {
  height: 100%;
}
.wt-term-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 80%, transparent);
  color: var(--dsw-alias-label-tertiary, #8b949e);
  font-size: 12px;
  pointer-events: none;
}
.wt-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary, #8b949e);
  font-size: 13px;
}
.wt-rename-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  background: var(--dsw-alias-bg-layer-1, #f6f8fa);
  color: inherit;
  outline: none;
}
.wt-rename-input:focus {
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
}

/* ── 移动端浮动辅助键盘（默认隐藏，≤767px 见下方媒体查询）── */
.wt-keybar {
  display: none;
}

/* ── 移动端（≤767px）：全屏 + 隐藏分割（单叶显示）── */
@media (max-width: 767px) {
  .wt-modal {
    position: fixed;
    inset: 0;
    margin: 0;
    width: 100% !important;
    max-width: none !important;
    height: 100%;
    max-height: none;
    border: none;
    border-radius: 0 !important;
  }
  /* 移动端不支持分屏：分割/单屏按钮隐藏（逻辑侧另有守卫）。 */
  .wt-desktop-only {
    display: none !important;
  }
  .wt-gutter {
    display: none;
  }
  .wt-cell {
    flex-basis: auto !important;
  }
  /* 非焦点叶隐藏：焦点叶占满。 */
  .wt-leaf {
    display: none;
  }
  .wt-leaf-focus {
    display: flex;
  }
  .wt-tab-name {
    max-width: 90px;
  }
  /* 给底部浮动工具栏让位（48px 键区 + 安全区）。 */
  .wt-panel {
    padding-bottom: calc(48px + env(safe-area-inset-bottom, 0px));
  }
  /* 浮动工具栏：钉在面板底部；输入法弹出时组件内联 bottom 上浮。
     absolute（相对 .wt-panel）而非 fixed：逃逸模态卡动画 transform
     造成的固定定位包含块问题。 */
  .wt-keybar {
    display: flex;
    align-items: center;
    gap: 6px;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(48px + env(safe-area-inset-bottom, 0px));
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
    box-sizing: border-box;
    background: var(--dsw-alias-bg-layer-1, #f6f8fa);
    border-top: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
    overflow-x: auto;
    scrollbar-width: none;
    z-index: 5;
  }
  .wt-keybar-key {
    flex: none;
    min-width: 42px;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--dsw-alias-border-l2, #d0d7de);
    border-radius: 8px;
    background: var(--dsw-alias-button-elevated-fill, #ffffff);
    color: var(--dsw-alias-label-primary, #1f2328);
    font-family: inherit;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }
  .wt-keybar-key:active {
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
  }
  .wt-keybar-key-active,
  .wt-keybar-key-active:active {
    background: var(--dsw-alias-brand-primary, #4d6bfe);
    border-color: transparent;
    color: var(--dsw-alias-label-primary-inverted, #ffffff);
  }
}
`

/** xterm 基础结构样式 + 本插件面板样式（一并经 data-plugin-css 注入）。 */
export const webTerminalAllCss = `${xtermCss}\n${webTerminalCss}`
