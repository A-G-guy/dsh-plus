/**
 * 移动端覆盖样式：基础层。断点 767px（手机竖屏）为主；上游布局框架自带
 * 1024px 侧栏自动折叠，本层只补内容级防溢出与触屏可达性。
 *
 * 选择器策略（上游版本基准 0.1.2-alpha.2 复核：CSS 局部名不变、hash 免疫）：
 * - 上游 CSS Modules 类名 = 哈希前缀_语义后缀（如 pI_x6G_frame），哈希随构建变、
 *   后缀稳定，故一律用 [class*="_语义后缀"] 子串匹配；
 * - shell 侧旧格式为 _语义_哈希_序号（如 _remove_1hk8w_53），子串同样适配；
 * - 全局稳定类（.md-code-block、.katex-display）直接使用。
 * @module @dsh-plus/ui-mobile-fit/styles/base
 */

/** 窄屏与触屏基础修复：一屏化根锁（防整页横竖滚动）、长串折行、输入防 iOS 缩放。 */
export const baseCss = /* css */ `
/* 一屏化根锁：整页（html/body/#root）横竖都不可拖动，滚动只允许内部容器。
   触屏媒体并列——横屏手机/平板宽度大于 767px 不匹配窄屏断点，同样必须锁住。 */
@media (max-width: 767px), (pointer: coarse) {
  /* 根壳高度取动态视口：height:100% 的基准（ICB）在移动端可能大于可见视口
     （iOS 地址栏展开时是大视口），整页因此留下可拖动的余量、底部还被压在
     地址栏后面。dvh 恒等于当前可见视口（配 resizes-content 也随键盘收缩），
     旧内核不识别该单位时回落到 100%。 */
  html {
    height: 100%;
    height: 100dvh;
  }

  /* 双轴锁：hidden 兜底不支持 clip 的旧内核（仅禁手动拖动），clip 覆盖其上——
     clip 不生成滚动容器（不影响 sticky/fixed），且手动与程序化（focus、
     scrollIntoView 拉动整页）一律滚不动。body/#root 裁掉越界内容后文档无可滚
     区域，根溢出按规范映射到视口即 hidden，两个方向都拖不动；浮层是
     position:fixed 不计入文档滚动区，内部 overflow:auto 滚动容器不受影响。 */
  html,
  body,
  #root {
    overflow: hidden;
    overflow: clip;
  }
}

@media (max-width: 767px) {
  /* 长 URL / 无空格串在 markdown 与面包屑内折行（0.1.2-alpha.2 基线 chip 系统为
     nowrap+缩放方案，自带溢出处理，无需此处覆盖） */
  [class*="_markdown"],
  [class*="_crumb"],
  [class*="_summary"] {
    overflow-wrap: anywhere;
  }

  /* 代码例外：保持 pre/code 原样不折行，交由块内横向滚动（上游 body 已
     overflow-x:auto），避免 anywhere 继承进代码毁掉缩进可读性 */
  [class*="_markdown"] pre,
  [class*="_markdown"] code,
  .md-code-block,
  .md-code-block * {
    overflow-wrap: normal;
    word-break: normal;
  }

  /* 输入控件字号 ≥16px，避免 iOS Safari 聚焦时自动放大页面 */
  input,
  textarea,
  select,
  [contenteditable="true"] {
    font-size: max(16px, 1em);
  }
}
`
