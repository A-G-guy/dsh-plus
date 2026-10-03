---
last_modified: "2026-10-04 03:46"
description: "@dsh-plus/shared"
type: fact
---

# @dsh-plus/shared

工作区共享库（非 dsh 插件）。两个消费面：

## 主入口 `.`（node 半纯函数）

- `transformText` / `isTransformOp` / `TRANSFORM_OPS`：tool-text-transform 的
  演示变换（历史保留）。

## 子路径 `./client`（浏览器半卡片套件）

源码级消费：各插件 client 构建时打苞进自身 bundle（shared 无 client bundle
row，不能作为动态 external；消费方 tsdown 需
`deps: { neverBundle: ['react', 'react/jsx-runtime'], alwaysBundle: ['@dsh-plus/shared/**'] }`，
alwaysBundle 需通配子路径——picomatch 裸包名不匹配 `pkg/subpath`）。

| 模块 | 内容 |
|---|---|
| `scope.ts` | `createSettingsScope` / `createNamespaceApi`：`ctx.remote.settings` 直连的命名空间 scope 与写/探活面（describe 读 + `settings/document-updated` / `connection/reset` 刷新，generation 防旧读覆盖；0.1.2-alpha 线起替代已删除的 connection.api.settings） |
| `config-slots.ts` | `injectPluginConfigCard` 三槽位注册（legacy `settings.plugin.item` + 插件页 `plugins.row.config` / `plugins.bundle.config`）；`cardVariantFor(view)` 纯函数：page → `section`，summary / legacy → `card` |
| `card.tsx` | `CardChrome`：官方卡片同构外壳，两种形态——`card`（折叠/标题/状态徽标/未保存标记/sticky footer/actions）与 `section`（宿主内嵌无边框分节：13px/600 小节标题 + 字段区 + 非 sticky 页脚、横向零内边距）；`CardLoading` 为同形态加载占位 |
| `draft.ts` | `useNamespaceDraft`：单命名空间 staged 草稿 hook（播种/脏判定/revision fencing 保存/状态行），简单卡片免去重复实现；`from`/`patch` 必须传模块级稳定函数 |
| `fields.tsx` | `TextField` / `CheckRow` / `SelectField`（`prefix` 注入类名前缀） |
| `styles.ts` | `cardCss(prefix, extra?)` 卡片与分节形态全套样式 + 移动端增强（≤767px 输入 16px 防缩放、44px 热区、card 形态 footer 吸底；pointer:coarse 同热区）；`injectCardStyle(pluginId, css)` 官方 data-plugin-css 注入 |
| `i18n.ts` | `commonZh/commonEn` 公共文案 + `mergeDict` 合并 |
| `fetch.ts` | 同源端点 `getJson` / `postJson` |

消费方：notify-email / access-gate / llm-pi / subagent-model / image-studio /
usage-panel 的配置卡片，web-cache-headers / web-shell-sw / web-boot-timing /
web-search-services 的配置卡片，以及 usage-panel 的设置页、lifeboat 健康页。

形态选择：插件页 page 视图一律传 `variant={cardVariantFor(props.view)}`——宿主页面
已提供页面级内边距与标题，再套卡片即卡片套卡片（移动端可用宽度被逐层扣减）；
legacy 槽位的宿主是列表容器，保持卡片形态。

注意：`card.tsx` / `fields.tsx` 含 JSX，node --test 直接 import 会因 .tsx
扩展名失败——纯逻辑测试请从 `./styles.ts` / `./i18n.ts` / `./config-slots.ts`
等具体模块导入（`draft.ts` 含 React hook，同样不可直测）。
