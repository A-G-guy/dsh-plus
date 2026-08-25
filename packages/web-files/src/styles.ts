/**
 * 面板样式：全部颜色引用 --dsw-* 设计令牌（跟随原生深浅色主题），
 * 响应式断点 767px 与 @dsh-plus/ui-mobile-fit 对齐。
 * 构建期内联为字符串，客户端经 data-plugin-css style 标签注入（HMR 可卸载）。
 * @module @dsh-plus/web-files/styles
 */

export const webFilesCss = `
/* ── 侧边栏入口（与原生「设置」入口同款：整行图标+文案 / rail 圆形图标）── */
/* flex: 1 1 0 + min-width: 0：footer 横排容纳多个插件入口（终端/文件）时
   等分宽度不溢出；单入口时等同整行。 */
.wf-entry {
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
.wf-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.wf-entry-rail {
  flex: none;
  width: 36px;
  height: 36px;
  margin: 8px 0 10px;
  padding: 0;
  border-radius: 50%;
  justify-content: center;
  gap: 0;
}
.wf-entry-label {
  white-space: nowrap;
  overflow: hidden;
}

/* ── 模态卡（覆盖 primitives Modal 默认尺寸）── */
.wf-modal {
  width: min(1080px, 92vw) !important;
  max-width: none !important;
  height: min(720px, 86vh);
  padding: 0 !important;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wf-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.wf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  flex: none;
}
.wf-title {
  font-weight: 600;
  font-size: 14px;
}
.wf-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #57606a);
  cursor: pointer;
  padding: 0;
}
.wf-icon-button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #1f2328);
}
.wf-icon-button:disabled {
  opacity: 0.35;
  cursor: default;
}
.wf-icon-button:disabled:hover {
  background: transparent;
  color: var(--dsw-alias-label-secondary, #57606a);
}

/* ── 双栏主体 ── */
.wf-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.wf-pane-list {
  width: 360px;
  flex: none;
  border-right: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.wf-pane-view {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── 浏览区 ── */
.wf-browser {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.wf-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  flex: none;
  overflow-x: auto;
  scrollbar-width: none;
}
.wf-toolbar button {
  white-space: nowrap;
  flex: none;
}
.wf-toolbar-end {
  margin-left: auto;
  flex: none;
  display: inline-flex;
}
.wf-crumbs-row {
  padding: 0 10px 8px;
  flex: none;
}
.wf-crumbs {
  display: flex;
  align-items: center;
  overflow-x: auto;
  white-space: nowrap;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #8b949e);
  scrollbar-width: none;
}
.wf-crumb {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.wf-crumb-button {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 8px;
  font-size: 12px;
}
.wf-crumb-button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #1f2328);
}
.wf-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px 8px;
}
.wf-list-note {
  padding: 16px 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #8b949e);
  text-align: center;
}
.wf-row {
  display: flex;
  align-items: center;
  border-radius: 12px;
}
.wf-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
}
.wf-row-selected,
.wf-row-selected:hover {
  background: var(--dsw-alias-interactive-bg-active, rgba(77, 107, 254, 0.12));
}
.wf-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 7px 8px;
  cursor: pointer;
  color: inherit;
  font-size: 13px;
  text-align: left;
}
.wf-row-icon {
  display: inline-flex;
  color: var(--dsw-alias-label-secondary, #57606a);
  flex: none;
}
.wf-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-row-meta {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8b949e);
  width: 64px;
  text-align: right;
}
.wf-row-time {
  width: 108px;
}
.wf-row-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 4px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8b949e);
  cursor: pointer;
  opacity: 0;
}
.wf-row:hover .wf-row-menu-trigger,
.wf-row-menu-trigger:focus-visible {
  opacity: 1;
}
.wf-row-menu-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-label-primary, #1f2328);
}

/* ── 查看/编辑区 ── */
.wf-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--dsw-alias-label-tertiary, #8b949e);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}
.wf-placeholder-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #57606a);
  word-break: break-all;
}
.wf-placeholder-note {
  font-size: 12px;
}
.wf-back {
  display: none;
}
.wf-fileview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.wf-filehead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  flex: none;
}
.wf-filename {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.wf-dirty {
  font-size: 11px;
  color: var(--dsw-alias-state-warn-label, #9a6700);
}
.wf-readonly-tag {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8b949e);
  font-weight: 400;
}
.wf-fileactions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.wf-banner {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--dsw-alias-state-warn-label, #9a6700);
  background: var(--dsw-alias-bg-layer-1, #f6f8fa);
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  flex: none;
}
.wf-editor-host {
  flex: 1;
  min-height: 0;
}
.wf-editor {
  height: 100%;
}
.wf-editor .cm-editor {
  height: 100%;
}
.wf-editor .cm-scroller {
  overflow: auto;
}

/* ── 移动端（≤767px，与 ui-mobile-fit 断点对齐）：全屏 + 单栏切换 ── */
@media (max-width: 767px) {
  .wf-modal {
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
  .wf-pane-list {
    width: 100%;
    border-right: none;
  }
  .wf-pane-view {
    display: none;
  }
  .wf-panel-viewing .wf-pane-list {
    display: none;
  }
  .wf-panel-viewing .wf-pane-view {
    display: flex;
  }
  .wf-back {
    display: inline-flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--dsw-alias-brand-primary, #4d6bfe);
    font-size: 13px;
    cursor: pointer;
    padding: 4px 0;
    flex: none;
  }
  .wf-row-time {
    display: none;
  }
  .wf-row-menu-trigger {
    opacity: 1;
  }
}
`
