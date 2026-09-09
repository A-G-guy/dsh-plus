/**
 * 图像工作室前端样式：侧栏入口 + 工作台（官方 Modal 承载）+ 配置卡片附加件。
 * 设计令牌仅用 dsh-client-ui-theme 实测存在的 --dsw-alias-*（深浅色自适应）；
 * 模态骨架（遮罩/Escape/portal 层叠）由官方 Modal 原语承载，本表只覆写尺寸
 * 与内部布局（.ims-modal 等，模式同 web-files/web-terminal 的 wf-/wt-modal）。
 * 响应式断点 767px 与 @dsh-plus/ui-mobile-fit 对齐（移动端全屏、单列、44px 热区）。
 * @module image-studio/client/styles
 */

const PKG = '@dsh-plus/image-studio'
const STYLE_TAG_ID = `${PKG}/styles.css`

export const imageStudioCss = `
/* ── 侧边栏入口（与文件/终端入口同款；flex:1 1 0 与邻居等分 footer 行宽）── */
.ims-entry {
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
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  overflow: hidden;
}
.ims-entry:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ims-entry-rail {
  flex: none;
  width: 36px;
  height: 36px;
  margin: 8px 0 10px;
  padding: 0;
  border-radius: 50%;
  justify-content: center;
  gap: 0;
}
.ims-entry-label { white-space: nowrap; overflow: hidden; }

/* ── 工作台模态尺寸覆写（官方 Modal headless 卡片）── */
.ims-modal {
  width: min(1100px, 94vw) !important;
  max-width: none !important;
  height: min(780px, 88vh);
  padding: 0 !important;
  gap: 0 !important;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── 面板骨架 ── */
.ims-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
  color: var(--dsw-alias-label-primary);
}
.ims-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
}
.ims-tabs { display: flex; flex: 1; gap: 4px; min-width: 0; }
.ims-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}
.ims-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ims-tabActive {
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.ims-iconBtn {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.ims-iconBtn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ims-body { flex: 1; min-height: 0; overflow-y: auto; }

/* ── 通用件 ── */
.ims-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
}
.ims-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 0; }
.ims-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.ims-btn:disabled { opacity: .5; cursor: not-allowed; }
.ims-btnPrimary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-inverted);
}
.ims-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.ims-btnGhost {
  background: transparent;
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
}
.ims-btnGhost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.ims-btnDanger { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-label-primary-inverted); }
.ims-btnSmall { min-height: 28px; padding: 3px 10px; font-size: 12px; }
.ims-hint { margin: 4px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.ims-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.ims-badge {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
}
.ims-badgeOn { background: var(--dsw-alias-state-success-secondary); color: var(--dsw-alias-state-success-primary); }
.ims-badgeOff { background: var(--dsw-alias-state-error-secondary); color: var(--dsw-alias-state-error-primary); }
.ims-status { margin: 8px 0 0; font-size: 12px; color: var(--dsw-alias-state-success-primary); }
.ims-statusError { color: var(--dsw-alias-state-error-primary); }
.ims-spin { animation: ims-rotate 1s linear infinite; }
@keyframes ims-rotate { to { transform: rotate(360deg); } }

/* ── 生图表单 ── */
.ims-gen {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 4fr);
  gap: 0 20px;
  padding: 16px;
}
.ims-gen[hidden] { display: none; }
.ims-genMain, .ims-genSide { min-width: 0; }
.ims-block { margin-bottom: 16px; }
.ims-blockTitle { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.ims-blockHead { align-items: center; }
.ims-blockHead .ims-blockTitle { margin: 0; flex: none; }
.ims-providerRow { display: flex; align-items: center; gap: 8px; }
.ims-checkLine {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  cursor: pointer;
}
.ims-inlineGrid { display: grid; gap: 8px; margin-top: 8px; }
.ims-mini { display: grid; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ims-prompt { resize: vertical; min-height: 96px; }
.ims-rowActions { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.ims-rowGrow { flex: 1; min-width: 0; }

/* 参数表单 */
.ims-paramGroup { display: grid; gap: 6px; }
.ims-paramRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
}
.ims-paramRowOn { background: var(--dsw-alias-bg-layer-1); }
.ims-paramText { flex: 1; min-width: 0; display: grid; }
.ims-paramKey { font-size: 12px; font-weight: 600; font-family: var(--ds-font-family-code); }
.ims-paramGen {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-weight: 400;
}
.ims-paramDesc {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ims-paramControl { width: 132px; flex: none; min-height: 30px; padding: 4px 8px; }
.ims-adv { margin-top: 8px; }
.ims-advSummary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 0;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
}
.ims-advCount {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 10px;
}

/* 开关（switch） */
.ims-switch { position: relative; display: inline-flex; flex: none; width: 30px; height: 18px; }
.ims-switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.ims-switchTrack {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform);
  transition: background .15s;
  pointer-events: none;
}
.ims-switchTrack::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
  transition: transform .15s;
}
.ims-switch input:checked + .ims-switchTrack { background: var(--dsw-alias-brand-primary); }
.ims-switch input:checked + .ims-switchTrack::after { transform: translateX(12px); }

/* 源图/遮罩缩略 */
.ims-sources { display: flex; flex-wrap: wrap; gap: 8px; }
.ims-thumb { position: relative; width: 64px; height: 64px; border-radius: 8px; overflow: hidden; }
.ims-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ims-thumbRemove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,.55);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.ims-thumbAdd {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 64px;
  height: 64px;
  border: 1px dashed var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  cursor: pointer;
}
.ims-thumbAdd:hover { background: var(--dsw-alias-interactive-bg-hover); }

/* 提交区 */
.ims-genFoot { grid-column: 1 / -1; border-top: 1px solid var(--dsw-alias-border-l3); padding-top: 12px; }
.ims-naming { display: flex; gap: 8px; margin-bottom: 8px; }
.ims-submit { width: 100%; min-height: 40px; font-size: 14px; margin-top: 8px; }

/* ── 子模态（图片选择器 / 画廊详情，官方 Modal 承载）── */
.ims-pickerModal {
  width: min(760px, 92vw) !important;
  max-width: none !important;
  max-height: 86vh;
  padding: 0 !important;
  gap: 0 !important;
}
.ims-detailModal {
  width: min(920px, 94vw) !important;
  max-width: none !important;
  max-height: 88vh;
  padding: 0 !important;
  gap: 0 !important;
}
.ims-sub {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: inherit;
  color: var(--dsw-alias-label-primary);
}
.ims-subHead {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
}
.ims-subTitle { margin: 0; font-size: 14px; }
.ims-subFoot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--dsw-alias-border-l3);
}
.ims-subFoot .ims-status { margin: 0 auto 0 0; }

/* 选择器网格 */
.ims-pickerGrid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  padding: 12px 14px;
}
.ims-pickerCell {
  position: relative;
  aspect-ratio: 1;
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 0;
  background: none;
  cursor: pointer;
  overflow: hidden;
}
.ims-pickerCell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ims-pickerCellOn { border-color: var(--dsw-alias-brand-primary); }
.ims-pickerMark {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

/* ── 画廊 ── */
.ims-gallery { padding: 12px 16px; }
.ims-gallery[hidden] { display: none; }
.ims-galleryBar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ims-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.ims-cell {
  position: relative;
  aspect-ratio: 1;
  border: none;
  border-radius: 10px;
  padding: 0;
  background: var(--dsw-alias-bg-layer-1);
  cursor: pointer;
  overflow: hidden;
}
.ims-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ims-cellPrompt {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 8px 6px;
  background: linear-gradient(transparent, rgba(0,0,0,.72));
  color: #fff;
  font-size: 11px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transition: opacity .15s;
}
.ims-cell:hover .ims-cellPrompt, .ims-cell:focus-visible .ims-cellPrompt { opacity: 1; }

/* 详情 */
.ims-detailMeta { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.ims-detailBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px;
  padding: 14px;
}
.ims-detailImages { display: grid; gap: 10px; align-content: start; }
.ims-detailFigure { margin: 0; display: grid; gap: 6px; }
.ims-detailFigure img {
  width: 100%;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  display: block;
}
.ims-detailFigure figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ims-revised {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ims-detailInfo { min-width: 0; }
.ims-detailLabel { margin: 12px 0 6px; font-size: 12px; font-weight: 600; }
.ims-detailLabel:first-child { margin-top: 0; }
.ims-detailPrompt { margin: 0; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.ims-paramTable { width: 100%; border-collapse: collapse; font-size: 12px; }
.ims-paramTable td { padding: 4px 6px; border-top: 1px solid var(--dsw-alias-border-l3); word-break: break-all; }
.ims-paramTableKey { font-family: var(--ds-font-family-code); font-weight: 600; white-space: nowrap; }

/* ── 任务条 ── */
.ims-tasks {
  display: flex;
  flex: none;
  gap: 8px;
  padding: 8px 12px;
  margin: 0;
  overflow-x: auto;
  border-top: 1px solid var(--dsw-alias-border-l3);
}
.ims-task {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  max-width: 340px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
}
.ims-taskState { font-weight: 600; flex: none; }
.ims-taskState-running { color: var(--dsw-alias-brand-primary); }
.ims-taskState-queued { color: var(--dsw-alias-label-tertiary); }
.ims-taskState-succeeded { color: var(--dsw-alias-state-success-primary); }
.ims-taskState-failed { color: var(--dsw-alias-state-error-primary); }
.ims-taskState-cancelled { color: var(--dsw-alias-label-tertiary); }
.ims-taskPrompt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ims-taskModel { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.ims-taskError {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-state-error-primary);
}

/* ── 配置卡片附加件（imsc- 基础类由 cardCss('imsc') 生成）── */
.imsc-loading{padding:14px 16px;margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.imsc-groupTitle { margin: 14px 0 6px; font-size: 13px; font-weight: 600; }
.imsc-presetBox {
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 10px;
  display: grid;
  gap: 8px;
}
.imsc-presetHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.imsc-presetName { font-size: 13px; font-weight: 600; }
.imsc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.imsc-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 64px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  resize: vertical;
}
.imsc-credRow { display: flex; align-items: center; gap: 8px; }
.imsc-credRow .imsc-input { flex: 1; min-width: 0; }

/* ── 移动端（≤767px，与 ui-mobile-fit 同断点）── */
@media (max-width: 767px) {
  .ims-modal {
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
  .ims-gen { grid-template-columns: minmax(0, 1fr); }
  .ims-genSide { margin-top: 4px; }
  .ims-tab { padding: 0 10px; }
  .ims-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ims-detailBody { grid-template-columns: minmax(0, 1fr); }
  .ims-pickerModal, .ims-detailModal {
    position: fixed;
    inset: 0;
    width: 100% !important;
    max-width: none !important;
    max-height: none;
    height: 100%;
    border: none;
    border-radius: 0 !important;
  }
  .ims-paramControl { width: 108px; }
  .ims-btn { min-height: 40px; }
  .ims-btnSmall { min-height: 32px; }
  .imsc-grid2 { grid-template-columns: 1fr; }
}
`

/** 注入面板 + 入口 + 卡片附加样式（重复调用幂等：已存在则跳过）。 */
export function injectStudioStyles(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) {
    return null
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = PKG
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = imageStudioCss
  document.head.appendChild(tag)
  return tag
}
