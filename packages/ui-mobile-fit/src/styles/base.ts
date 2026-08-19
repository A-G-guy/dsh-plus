/**
 * 移动端覆盖样式：基础层。断点 767px（手机竖屏）为主；上游布局框架自带
 * 1024px 侧栏自动折叠，本层只补内容级防溢出与触屏可达性。
 *
 * 选择器策略（上游版本基准 0.1.0-rc.8）：
 * - 上游 CSS Modules 类名 = 哈希前缀_语义后缀（如 pI_x6G_frame），哈希随构建变、
 *   后缀稳定，故一律用 [class*="_语义后缀"] 子串匹配；
 * - shell 侧旧格式为 _语义_哈希_序号（如 _remove_1hk8w_53），子串同样适配；
 * - 全局稳定类（.md-code-block、.katex-display）直接使用。
 * @module @dsh-plus/ui-mobile-fit/styles/base
 */

/** 窄屏基础修复：防横向整页滚动、长串折行、输入框防 iOS 聚焦缩放。 */
export const baseCss = /* css */ `
@media (max-width: 767px) {
  /* 防任何子元素撑出横向整页滚动；clip 不生成滚动容器，不影响 sticky */
  html,
  body,
  #root {
    overflow-x: clip;
  }

  /* 长 URL / 无空格串在 markdown 与面包屑内折行（rc8 chip 系统已重构为
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
