/**
 * 移动端覆盖样式：覆盖层（对话框、菜单、设置页、tooltip 类浮层）。
 * 窄屏下浮层近全屏化并内部滚动，避免固定宽度溢出或关闭按钮不可达。
 * @module @dsh-plus/ui-mobile-fit/styles/overlays
 */

/** 窄屏覆盖层修复。 */
export const overlaysCss = /* css */ `
@media (max-width: 767px) {
  /* 语义化对话框（settings-models 的 deleteDialog/fetchDialog 等均走 role=dialog） */
  [role="dialog"],
  [class*="_deleteDialog"],
  [class*="_fetchDialog"] {
    max-width: calc(100vw - 24px);
    max-height: calc(100dvh - 48px);
    overflow: auto;
  }

  /* 下拉/上下文菜单：防右侧溢出，内部可滚 */
  [role="menu"],
  [role="listbox"] {
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - 96px);
    overflow: auto;
  }

  /* 设置面板（_overlay > _panel > _nav + _content）：窄屏纵向堆叠，
     左侧导航转为顶部横向滚动条，内容区占满全宽。:has 限定避免误伤
     conversation 的 _overlayLayer / sidebar 的 _panelIcon 等同子串类名 */
  [class*="_overlay"] > [class*="_panel"]:has(> [class*="_nav"]) {
    flex-direction: column;
    width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
  }

  [class*="_panel"]:has(> [class*="_nav"]) > [class*="_nav"] {
    width: 100%;
    flex: none;
  }

  [class*="_panel"]:has(> [class*="_nav"]) > [class*="_nav"] [class*="_navList"] {
    flex-direction: row;
    width: 100%;
    overflow-x: auto;
  }

  [class*="_panel"]:has(> [class*="_nav"]) [class*="_navList"] > * {
    flex-shrink: 0;
  }

  [class*="_panel"]:has(> [class*="_nav"]) > [class*="_content"] {
    width: 100%;
    flex: 1;
    min-height: 0;
  }

  /* 设置类长表单：窄屏去掉硬性并排，标签/控件纵向堆叠 */
  [class*="_modelField"],
  [class*="_modelRow"] {
    flex-wrap: wrap;
    min-width: 0;
  }

  /* 设置条目行（_row > _rowText + 控件）：上游 Select 等控件固有宽度
     （实测 intrinsic ~247px）在窄屏把文本列压到一行一字。行内允许换行，
     文本保底 55%，控件让位到下一行并限宽 */
  [class*="_panel"] [class*="_row"] {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  [class*="_panel"] [class*="_row"] [class*="_rowText"] {
    min-width: 55%;
  }

  [class*="_panel"] [class*="_row"] > [class*="_root"] {
    max-width: 100%;
    min-width: 0;
  }

  [class*="_panel"] [class*="_row"] [class*="_selector"] {
    max-width: 100%;
  }

  [class*="_modelCatalog"],
  [class*="_modelList"] {
    max-width: 100%;
    overflow-x: auto;
  }
}

/* 触屏 Tooltip 自动隐藏：点按会同时触发上游 Tooltip 的 mouseenter/focus，
   而触屏没有 mouseleave/blur 收尾，说明气泡常驻遮挡内容（如侧栏"收起侧边栏"、
   会话"视图选项"）。让气泡短暂可见后自动淡出，终态 opacity:0 由 forwards
   保持（气泡本就 pointer-events:none，透明后不遮视线也不挡点击）。注意勿在
   关键帧里写 visibility:hidden——Chrome 会在整个动画期间提前生效，气泡将
   全程不可见（实测验证）。React 每次展示都会重挂 bubble span，动画随之重启；
   桌面 hover 路径不在 coarse 媒体内，不受影响。选择器锚定上游 primitives
   Tooltip 的 _bubble + data-side 组合（全包唯一，哈希失配时仅降级回常驻
   气泡）。对 dsh-plus 自家面板（web-files 等同用 primitives Tooltip）一并
   生效。不限窄屏：平板等宽屏触屏同样有驻留问题。 */
@media (pointer: coarse) {
  span[class*="_bubble"][data-side] {
    animation: dsh-mobile-tooltip-autohide 1.6s ease-in-out forwards;
  }

  @keyframes dsh-mobile-tooltip-autohide {
    0% {
      opacity: 0;
    }
    8% {
      opacity: 1;
    }
    75% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
}
`
