/**
 * 移动端覆盖样式：会话内容层（dsh-client-ui-conversation / dsh-client-ui-tool）。
 * 目标：消息流、markdown、代码块、表格、工具卡片、composer 在窄屏不溢出、可操作。
 * @module @dsh-plus/ui-mobile-fit/styles/conversation
 */

/** 窄屏会话区修复。 */
export const conversationCss = /* css */ `
@media (max-width: 767px) {
  /* markdown 富媒体：图片/视频不撑破，表格转块级内部横滚 */
  [class*="_markdown"] img,
  [class*="_markdown"] video,
  [class*="_markdown"] canvas,
  [class*="_markdown"] svg {
    max-width: 100%;
    height: auto;
  }

  [class*="_markdown"] table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
  }

  /* 代码块与 KaTeX 公式：上限容器宽，内部横滚（上游 body 已 overflow-x:auto，
     这里兜底块级外壳） */
  .md-code-block,
  .katex-display,
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

  [class*="_crumbs"] {
    min-width: 0;
    overflow: hidden;
  }

  [class*="_headerActions"],
  [class*="_headerUtilities"] {
    flex-shrink: 0;
  }

  /* composer：占满窄屏宽度，附件/模式行允许换行。
     0.1.2-alpha.2 基线上游 composer 输入行（ui-conversation InputBar 的 .row）
     已自带 flex-wrap:wrap（窄屏布局），此处保留 _tools/_modes 子级换行兜底；
     附件区 _accessory 已核对存在于 master（InputBar.module.css .accessory，
     ui-attachment 的 rail 为横向滚动，无需换行） */
  [class*="_composerStack"],
  [class*="_composerSeat"],
  [class*="_composerHero"] {
    max-width: 100%;
  }

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
`
