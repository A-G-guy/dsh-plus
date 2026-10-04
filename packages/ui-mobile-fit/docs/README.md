---
last_modified: "2026-10-04 16:31"
description: "@dsh-plus/ui-mobile-fit"
type: fact
---

# @dsh-plus/ui-mobile-fit

纯覆盖式（CSS + 极少量行为胶水）的 DSH Web UI 移动端窄屏适配插件。不 fork
上游、不注册替代组件：浏览器半仅注入覆盖样式与少数全局事件监听，上游升级
自动跟随；选择器失配时仅降级回上游原生表现，不破坏功能。

## 契约

- node 半：空 `apply`，仅声明客户端模块（`package.json` 的 `dsh.client` 标记 +
  `exports["./client"]`），由 `dsh-client-modules` 扫描进 `window.__DSH_BOOT__`。
- 浏览器半 `src/client.ts`：cordis 风格 `{ name, apply }`，构建为
  `window.__ModuleLoader__.load({id, factory})` CJS factory（包装见
  `tsdown.config.ts` 的 banner/footer）。零运行时依赖。
- style 标签沿用官方 `data-plugin` / `data-plugin-css` 约定，
  `dsh-client-hmr` 据此热更卸载；`ctx.effect` 返回值负责移除标签与事件监听。

## 覆盖内容（`src/styles/`，@media max-width: 767px 为主，根锁并列 pointer: coarse）

| 层 | 文件 | 内容 |
|---|---|---|
| 基础 | `base.ts` | 一屏化根锁（整页两轴不可滚 + 根壳 100dvh，见坑 4）、长串折行（代码块例外）、输入框 ≥16px 防 iOS 缩放 |
| 布局 | `layout.ts` | 收起态 rail 全隐+展开按钮外移 header、展开态侧栏/详情 drawer 化且内容满宽、composer 随 --dsh-ime-inset 上浮（仅 `html[data-dsh-ime]` 期间挂 transform）、触屏隐藏拖拽手柄 |
| 会话 | `conversation.ts` | markdown 图片/表格/代码块容器内滚动、工具卡片防溢出、composer 全宽换行、接管卡片（计划待审/提问/审批）footer 换行防按钮裁剪 |
| 覆盖层 | `overlays.ts` | 对话框/菜单视口内收编、设置面板 nav+content 纵向堆叠（nav 横向滚动）、触屏 Tooltip 气泡自动隐藏 |

### 非显而易见的坑（成因与对策）

1. **transform 包含块陷阱**：`transform` 取任何非 none 值（含 `translateY(0)`）都会让
   composerSeat 成为 `position:fixed` 后代的包含块。上游 Tooltip 内联渲染在 composer
   内（非 portal），fixed 坐标按视口计算却相对 seat 盒子定位——浮层掉到视口外很远处
   并撑高滚动区（表现：点输入框下方信息行看详情，详情跑到页面最底部、整页可下滑很深）。
   故 IME 上浮的 transform 只在键盘弹出期间（`html[data-dsh-ime]`）挂载。
2. **接管卡片 footer 裁剪**：计划待审/提问卡片 footer 按钮组在窄屏超出卡片宽度，而
   卡片 `overflow:hidden` 会把主操作按钮（确认执行/提交）裁掉。选择器锚定上游稳定
   data 钩子（`data-plan-review-key` / `data-question-key` / `data-approval-key`），
   footer 允许换行、操作组可收缩右对齐。
3. **触屏 Tooltip 常驻遮挡**：上游 primitives Tooltip 靠 mouseenter/focus 显示、
   mouseleave/blur 隐藏；触屏点按只有前半段（还会带 500ms delay），气泡永不消失
   遮挡内容（侧栏"收起侧边栏"、会话"视图选项"等）。修复为纯 CSS：coarse 媒体内给
   `span[class*="_bubble"][data-side]`（上游全包唯一标识 Tooltip 气泡）挂 1.6s
   自动淡出动画，终态 `visibility:hidden` 由 forwards 保持；React 每次展示重挂
   span 使动画重启，桌面 hover 路径不受影响。对同用 primitives Tooltip 的
   dsh-plus 自家面板（web-files）一并生效。
4. **整页可横竖拖动**（应一屏化，仅内部可滚）：三处成因叠加——(a) 旧规则只锁
   `overflow-x: clip`，`overflow-y` 仍按 visible→auto 映射到视口，纵向整页滚动
   一直存在；(b) `height:100%` 的基准（ICB）在移动端可能大于可见视口（iOS 地址栏
   展开时是大视口），留下整页可拖的余量、底部还被压在地址栏后；(c) 断点只认
   767px，横屏手机/平板宽度超限后整段样式（含锁）全部失效。修复为根锁三件套：
   `html, body, #root` 双轴 `overflow: hidden`（兜底无 clip 的旧内核）→
   `overflow: clip`（不生成滚动容器保 sticky/fixed，连程序化 focus/
   scrollIntoView 拉动整页也禁掉），根壳 `height:100dvh`（恒等于当前可见视口，
   配 `interactive-widget=resizes-content` 也随键盘收缩），媒体并列
   `(pointer: coarse)`。根锁只裁文档层：浮层是 `position:fixed` 不计入文档滚动区，
   内部 `overflow:auto` 容器不受影响；桌面（宽 >767 且细指针）不匹配媒体，零影响。

## 行为胶水（`src/behaviors.ts`，均限窄屏生效）

纯 CSS 无法表达的三个交互，以全局监听实现，不触碰任何组件内部：

1. **IME 上浮**：meta viewport 追加 `interactive-widget=resizes-content`（Android
   布局随键盘收缩）；iOS 用 visualViewport 计算键盘高度写入 `--dsh-ime-inset`，
   并仅在键盘弹出期间给 `<html>` 挂 `data-dsh-ime` 属性，由 CSS translate
   composer（键盘收起即移除属性，transform 不常驻，见上方"坑 1"）。
2. **自动聚焦屏蔽**：无近期 pointerdown/keydown 手势时对 input/textarea 的程序化
   focus 一律 blur——切换会话不再弹出输入法（额外要求 pointer: coarse，桌面不受影响）。
3. **点按空白收起侧栏**：展开态下点按中列任意位置即收起（吞掉该次点按，模拟
   drawer 背板）。

## 选择器稳定性策略

上游（基准 0.1.6-alpha.2）CSS Modules 类名 = 哈希前缀 + 语义后缀（`pI_x6G_frame`），
shell 旧格式为 `_语义_哈希_序号`（`_remove_1hk8w_53`）。哈希随构建变化、语义后缀
稳定，故一律用 `[class*="_语义后缀"]` 子串匹配；`!important` 仅用于对抗内联
`grid-template-columns` 等内联样式，并就地注释说明。

语义后缀稳定是观察结论而非保证：上游更名不触发任何告警，只会表现为覆盖规则静默
失效（曾发生，见 [事故记录](../../../docs/repo/事故记录.md)），故**每次升级必须复核**——
把 CSS/behaviors 里全部 `class*="_x"` 与 `[data-*]` 抽出来，逐一在官方安装树
（各 `dsh-client-ui-*` 包的 `lib/*.js` + `dsh-web-frontend/dist/assets/*.css`）里检索：
**存活选择器必须命中，未命中的即为死规则，需改锚或删除**。逐版本复核结论与本插件
的锚点动作见 [上游跟进记录](上游跟进记录.md)。

## 开发与验证

```bash
pnpm --filter @dsh-plus/ui-mobile-fit build          # 构建（node 半 ESM + 浏览器半 factory）
pnpm --filter @dsh-plus/ui-mobile-fit watch          # watch：HMR 热更浏览器半
node --test packages/ui-mobile-fit/tests/*.test.ts     # 单元测试（纯逻辑，无网络）
```

端到端：独立 `DSH_HOME` 的 dev 实例 + playwright 375×812 视口实测，
核心断言 `documentElement.scrollWidth === innerWidth`、
`documentElement.scrollHeight === innerHeight`（一屏化：竖屏与横屏各测一次，
页面任何位置单指拖动都不产生整页位移）、rail 全隐/drawer 化、设置面板可完整
操作。桌面 1280px 需回归确认零影响。IME 上浮与自动聚焦屏蔽依赖触屏环境，
playwright 无法完全模拟，需真机抽查（另附真机项：iOS 地址栏展开时底部 composer
不被压住、键盘弹出 composer 仍上浮可见）。
