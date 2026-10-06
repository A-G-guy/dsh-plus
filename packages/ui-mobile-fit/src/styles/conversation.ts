/**
 * 移动端覆盖样式：会话内容层（dsh-client-ui-conversation / dsh-client-ui-tool）。
 * 目标：消息流、markdown、代码块、表格、工具卡片、composer 在窄屏不溢出、可操作。
 * @module @dsh-plus/ui-mobile-fit/styles/conversation
 */

/** 窄屏会话区修复。 */
export const conversationCss = /* css */ `
@media (max-width: 767px) {
  /* markdown 富媒体：<img> 由上游 .image 兜住（primitives 的 MarkdownText
     模块样式：display:block / width:auto / max-width:100% / height:auto），
     此处只补上游未覆盖的内联媒体元素；表格上游已改为滚动包裹层
     （_tableScroll，max-width:100% + overflow-x:auto，宽表配 md-table-wide），
     不再需要给 table 本身加 display:block 的历史写法。 */
  [class*="_markdown"] video,
  [class*="_markdown"] canvas,
  [class*="_markdown"] svg {
    max-width: 100%;
    height: auto;
  }

  /* 代码块外壳：上游 .markdown pre 只有 overflow:auto（无宽度上限），
     这里补 max-width 兜底块级外壳 */
  .md-code-block,
  [class*="_markdown"] pre {
    max-width: 100%;
    overflow-x: auto;
  }

  /* 工具卡片 IO 区：长命令/JSON 不撑破卡片 */
  [class*="_ioCard"],
  [class*="_ioText"],
  [class*="_codeBody"],
  [class*="_terminalBody"],
  [class*="_diffBody"] {
    max-width: 100%;
  }

  /* 会话头部：面包屑与标题让位，操作按钮不被挤出视口 */
  [class*="_titleRow"] {
    min-width: 0;
  }

  /* 面包屑与头部操作组不需要额外规则：上游 _crumbs 已 min-width:0 +
     overflow:hidden，_headerActions/_headerUtilities 已 flex:none（= 不收缩）。 */

  /* 顶栏横向空间紧张时允许换行（会话名/后台任务/子代理与右侧工具区各占一行），
     防止右侧操作被挤出视口无法点按 */
  [class*="_titleRow"] {
    flex-wrap: wrap;
    row-gap: 4px;
  }

  [class*="_headerUtilities"] {
    margin-left: 8px;
    gap: 6px;
  }

  /* composer：窄屏下附件/模式行允许换行。
     上游 _composerStack/_composerSeat 是 flex:none 的纵向容器（块级默认宽度已
     ≤ 容器），_composerHero 官方显式 width:min(…, 100%)，故不再需要 max-width
     兜底；上游 composer 输入行用容器查询（@container (width<=560px)）收紧间距，
     但没有换行，_tools/_modes/_accessory 的换行仍由本插件提供。 */
  [class*="_tools"],
  [class*="_modes"],
  [class*="_accessory"] {
    flex-wrap: wrap;
  }

  /* composer 接管卡片（计划待审 data-plan-review-key / 提问 data-question-key /
     审批 data-approval-key，上游稳定钩子）：footer 按钮组在窄屏超出卡片宽度，
     而卡片 overflow:hidden，主操作按钮（确认执行/提交）被裁掉无法点按。
     允许换行、操作组可收缩并右对齐，反馈/页码行可让位 */
  [data-plan-review-key] [class*="_footer"],
  [data-question-key] [class*="_footer"],
  [data-approval-key] [class*="_actionRow"] {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  [data-plan-review-key] [class*="_actions"],
  [data-question-key] [class*="_footerActions"] {
    flex: 0 1 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    min-width: 0;
    margin-left: auto;
  }

  [data-plan-review-key] [class*="_feedback"],
  [data-question-key] [class*="_feedback"] {
    flex: 0 1 auto;
    min-width: 0;
  }
}

/* 触屏附件二次选择层（behaviors.ts 动态挂到 body，固定类名）：
   底部小菜单，样式对齐官方菜单（变量同源）。 */
@media (pointer: coarse) {
  .dsh-mobile-attach-picker {
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
    transform: translateX(-50%);
    z-index: 60;
    box-sizing: border-box;
    flex-direction: column;
    min-width: 220px;
    border: 1px solid var(--dsw-alias-border-l2);
    background: var(--dsw-specific-menu);
    box-shadow: var(--dsw-shadow-lv3);
    border-radius: 14px;
    gap: 2px;
    margin: 0;
    padding: 6px;
    display: flex;
  }

  .dsh-mobile-attach-picker button {
    box-sizing: border-box;
    width: 100%;
    color: var(--dsw-alias-label-primary);
    cursor: pointer;
    border: 0;
    border-radius: 8px;
    text-align: left;
    background: transparent;
    font-family: var(--dsw-font-family);
    font-size: 15px;
    font-weight: 400;
    line-height: 22px;
    padding: 10px 12px;
  }

  .dsh-mobile-attach-picker button:active {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
`
