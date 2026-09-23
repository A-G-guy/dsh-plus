---
last_modified: "2026-09-23 12:00"
---

# @dsh-plus/remote-settings

修复**非 loopback 页面**（经 loopback-rewrite 反代或 `--trusted-host` 远程访问，
如 tailnet 域名）下官方设置平面不可用的问题：

- 设置 → 模型：「加载提供方目录失败: settings are unavailable in this browser」；
- 插件配置卡片：插件页按 mirror 视图配对，无视图不渲染；
- 启动期已构造的官方表单（chat/composer/agent-loop/welcome 等）钉死 memory：
- 不订阅 mirror、写入被 `enqueue` 拦截，仅翻 mirror 无法自愈。

## 根因（0.1.7-alpha.2 基线）

服务端设置 RPC 可达性由统一 /api 信任围栏（loopback 或 `--trusted-host` 声明的
authority）+ 浏览器令牌 cookie 认证把关；但浏览器侧 `dsh-client-ui-settings`
仍按 `remote.$host.isLoopback`（纯页面 hostname 判定）选择持久化——非 loopback
页面把共享 describe mirror 与 `configForms` 服务一起构造成 **memory 模式**，
永不发起 `settings.describe`，所有派生面（模型页、插件页配对、启动期表单）无数据。

部署了 loopback-rewrite 反代（Host 改写为 `127.0.0.1`、删除 Origin 后转发，
如 `dsh-proxy`）或声明了 `--trusted-host` 时，服务端围栏已放行，缺的只是
浏览器侧的 memory 降级——本插件补的正是它。

## 行为

浏览器半在启动时（inject `remote` + `remote.settings` + `configForms`，保证晚于
`dsh-client-ui-settings` 构造 ConfigForms/mirror）执行一次判定：

1. `configForms.persistence` 非 memory 降级（loopback 页已是 host）→ 无操作；
2. 探测 `settings.describe`：
   - **可达**（说明服务端会接受本页请求）→ 把 `configForms` 与 mirror 的
     `persistence` 从 `memory` 翻回 `host`，原地修复启动期已构造的 memory 表单
     （翻 persistence、快照翻 host 在途态、补 mirror 订阅与首次 derive，developerTools
     偏好原地覆写为 Host 语义且对象身份不变），最后触发一次 `mirror.load()`——
     模型页与插件配置卡片随即恢复正常（后者经 mirror 订阅自动配对渲染）；
   - **不可达**（直连且围栏未放行）→ 维持官方降级，不做任何改动。

`persistence`/`forms`/表单均为官方运行期属性（非公开契约）；上游实现漂移导致
任一前置面不命中时，对应阶段 no-op，整体不产生副作用。

## 历史迁移

- 0.1.7-alpha.2 起 `settingsScope` 服务被移除（修复面迁至 `configForms`），
  旧版 inject `settingsScope` 会在启动时报
  `pending (waiting for service: settingsScope)`——本插件已随基线迁移；
- 0.1.6 及以前仅翻 describe mirror（`settingsScope.describe()`），见 git 历史。

## 契约

- node 半：空 `apply`，仅声明客户端模块（`package.json` 的 `dsh.client` 标记 +
  `exports["./client"]`）。
- 浏览器半 `src/client.ts`：cordis 风格 `{ name, inject, apply }`，零运行时依赖，
  构建为 `window.__ModuleLoader__.load({id, factory})` CJS factory
  （包装见 `tsdown.config.ts`）。
- 核心判定 `maybeRepairSettingsPlane(deps)` 以窄接口注入依赖，可脱离浏览器单测
  （`tests/repair.test.ts`）。
