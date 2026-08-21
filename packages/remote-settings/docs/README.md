---
last_modified: "2026-08-21 15:29"
---

# @dsh-plus/remote-settings

修复**非 loopback 页面**（经 loopback-rewrite 反代远程访问，如 tailnet 域名）
下官方设置平面不可用的问题：

- 设置 → 模型：「加载提供方目录失败: settings are unavailable in this browser」；
- 设置 → 插件 → 插件配置：插件自定义卡片整体不渲染（空白）。

## 根因

官方把配置平面（`settings.*` / `credentials.*` / `llm.discoverModels` RPC）钉死在
loopback，两道闸门共同作用：

1. **服务端**：`dsh-client-connection` 的 `PRIVILEGED_METHODS` 用空信任列表判定
   请求 Host 头，非回环即 403（`--trusted-host` 也不能放宽，`docs` 称 "until a
   real authentication layer exists"）。
2. **浏览器侧**：`dsh-client-ui-settings` 的共享 describe mirror 按
   `connection.isLoopback`（纯 `location.hostname` 判定）选择持久化模式——非
   loopback 页面直接构造为 **memory 模式**，永不发起 `settings.describe`，
   所有经 `settingsScope.describe()` 取数的界面（模型页、插件配置 tab 的
   命名空间配对）全部无数据。

部署了 loopback-rewrite 反代（Host 改写为 `127.0.0.1`、删除 Origin 后转发，
如 `dsh-proxy`）时，第 1 道闸门已被解除，缺的只是第 2 道——本插件补的正是它。

## 行为

浏览器半在启动时（inject `connection` + `settingsScope`，保证晚于
`dsh-client-ui-settings` 构造 mirror）执行一次判定：

1. 页面 loopback 或 mirror 非 memory 降级态 → 无操作；
2. 探测 `settings.describe`：
   - **可达**（说明处于 loopback-rewrite 反代之后）→ 把 mirror 的
     `persistence` 从 `memory` 翻回 `host` 并触发 `load()`，模型页与插件
     配置卡片随即恢复正常（后者经 mirror 订阅自动配对渲染）；
   - **不可达**（直连 LAN IP 等无反代场景）→ 维持官方降级，不做任何改动。

`persistence` 是官方 `SettingsDescribeMirror` 的运行期属性（非公开契约）；
上游实现漂移导致前置条件不命中时，插件退化为无操作，不产生副作用。

## 契约

- node 半：空 `apply`，仅声明客户端模块（`package.json` 的 `dsh.client` 标记 +
  `exports["./client"]`）。
- 浏览器半 `src/client.ts`：cordis 风格 `{ name, inject, apply }`，零运行时依赖，
  构建为 `window.__ModuleLoader__.load({id, factory})` CJS factory
  （包装见 `tsdown.config.ts`）。
- 核心判定 `maybeRepairMirror(deps)` 以窄接口注入依赖，可脱离浏览器单测
  （`tests/repair.test.ts`）。
