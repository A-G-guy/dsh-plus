/**
 * 移动端覆盖样式：布局框架层（dsh-client-ui-layout 的 AppFrame 网格）。
 * - 收起态：56px rail 整体隐藏、主栏全宽，展开按钮外移到 header 左上角；
 * - 展开态：侧栏/详情面板为 drawer 覆盖层，不挤占中列；
 * - composer 随 --dsh-ime-inset 上浮（behaviors.ts 在键盘弹出时写入）。
 * @module @dsh-custom/ui-mobile-fit/styles/layout
 */

/** 窄屏布局规则。 */
export const layoutCss = /* css */ `
@media (max-width: 767px) {
  /* ── 收起态：rail 整体隐藏（对抗内联 grid-template-columns） ── */
  [class*="_frame"][data-sidebar-collapsed] {
    grid-template-columns: 0px minmax(0px, 1fr) 0px !important;
  }

  [class*="_frame"][data-sidebar-collapsed] > [class*="_sidebarCol"] {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0;
    overflow: visible;
    border-right: none;
  }

  /* rail 内容隐藏，仅展开按钮外移到 header 左上角（fixed 定位脱出零宽列）。
     注意设置弹窗 DOM 位于 sidebarCol 内部（settingsArea → footArea → root），
     visibility 可被子级显式覆盖，overlay/dialog 必须逃逸，否则收起态下
     已打开的设置弹窗会随 rail 一起消失 */
  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] [class*="_root"] {
    visibility: hidden;
  }

  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] [class*="_overlay"],
  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] [role="dialog"] {
    visibility: visible;
  }

  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] [class*="_toggle"] {
    visibility: visible;
    position: fixed;
    top: max(8px, env(safe-area-inset-top));
    left: 8px;
    z-index: 40;
    background: var(--dsw-alias-bg-base);
    border: 1px solid var(--dsw-alias-border-l1);
    border-radius: 8px;
  }

  /* 会话头部为外移的展开按钮让位 */
  [class*="_frame"][data-sidebar-collapsed] [class*="_centerCol"] [class*="_titleRow"] {
    padding-left: 48px;
  }

  /* 外移按钮常显面板图标：上游 rail 态默认显示 fish logo、仅 hover 才换
     面板图标，触屏无 hover 会导致展开入口不可辨识 */
  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] [class*="_toggle"] [class*="_panelIcon"] {
    display: inline !important;
  }

  [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] [class*="_toggle"] [class*="_railFish"] {
    display: none !important;
  }

  /* ── 展开态：drawer 覆盖层，中列保持全宽 ── */
  [class*="_frame"]:not([data-sidebar-collapsed]),
  [class*="_frame"]:not([data-details-collapsed]) {
    grid-template-columns: 0px minmax(0px, 1fr) 0px !important;
  }

  [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] {
    position: absolute;
    inset: 0 auto 0 0;
    width: min(85vw, 320px);
    z-index: 30;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  }

  /* drawer 内容填满宽度（上游内联 width:280px 跟随面板宽，此处放开） */
  [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] [class*="_root"] {
    width: 100% !important;
  }

  [class*="_frame"]:not([data-details-collapsed]) [class*="_detailsCol"] {
    position: absolute;
    inset: 0 0 0 auto;
    width: min(92vw, 420px);
    z-index: 30;
    border-left: 1px solid var(--dsw-alias-border-l2);
    box-shadow: -8px 0 32px rgba(0, 0, 0, 0.18);
  }

  /* 列脱离文档流后 grid 自动放置会让后续列前移，必须显式钉回各自轨道 */
  [class*="_frame"] > [class*="_sidebarCol"] {
    grid-column: 1;
    grid-row: 1;
  }

  [class*="_frame"] > [class*="_centerCol"] {
    grid-column: 2;
    grid-row: 1;
  }

  [class*="_frame"] > [class*="_detailsCol"] {
    grid-column: 3;
    grid-row: 1;
  }

  /* 中列最小宽度归零兜底（上游已 min-width:0，防御内联 grid 变更） */
  [class*="_centerCol"] {
    min-width: 0;
  }

  /* IME 上浮：behaviors.ts 仅在键盘弹出期间给 <html> 挂 data-dsh-ime。
     必须带守卫、不能常驻——transform 取非 none 值（含 translateY(0)）即让
     composerSeat 成为 position:fixed 后代的包含块：上游 Tooltip 等浮层
     内联渲染在 composer 内，fixed 坐标按视口计算却相对 seat 盒子定位，
     浮层会掉到视口外很远处并撑高滚动区（移动端"点开详情跑到页面最底部"） */
  html[data-dsh-ime] [class*="_composerSeat"],
  html[data-dsh-ime] [class*="_composerHero"] {
    transform: translateY(calc(0px - var(--dsh-ime-inset, 0px)));
  }
}

@media (pointer: coarse) {
  /* 8px 列宽拖拽手柄在触屏上无法操作，隐藏之（上游快捷键/按钮仍可折叠面板） */
  [class*="_frame"] > [class*="_handle"] {
    display: none;
  }
}
`
