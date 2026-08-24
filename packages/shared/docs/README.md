---
last_modified: "2026-08-25 03:46"
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
| `scope.ts` | `createApiScope`：官方 settings RPC 直连的命名空间 scope（describe 读 + `settings/document-updated` / `connection/reset` 刷新，generation 防旧读覆盖） |
| `card.tsx` | `CardChrome`：官方卡片同构外壳（折叠/标题/状态徽标/未保存标记/sticky footer/actions） |
| `fields.tsx` | `TextField` / `CheckRow` / `SelectField`（`prefix` 注入类名前缀） |
| `styles.ts` | `cardCss(prefix, extra?)` 全套卡片样式 + 移动端增强（≤767px 输入 16px 防缩放、44px 热区、footer 吸底；pointer:coarse 同热区）；`injectCardStyle(pluginId, css)` 官方 data-plugin-css 注入 |
| `i18n.ts` | `commonZh/commonEn` 公共文案 + `mergeDict` 合并 |
| `fetch.ts` | 同源端点 `getJson` / `postJson` |

消费方：notify-email / access-gate / subagent-model / llm-pi 的配置卡片、
usage-panel 的价目卡片与设置页、lifeboat 健康页。

注意：`card.tsx` / `fields.tsx` 含 JSX，node --test 直接 import 会因 .tsx
扩展名失败——纯逻辑测试请从 `./styles.ts` / `./i18n.ts` 具体模块导入。
