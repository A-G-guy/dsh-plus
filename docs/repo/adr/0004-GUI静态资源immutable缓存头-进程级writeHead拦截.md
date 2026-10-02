---
last_modified: "2026-10-02 22:40"
description: "ADR 0004：GUI 静态资源 immutable 缓存头走进程级 writeHead 拦截"
---

# ADR 0004：GUI 静态资源 immutable 缓存头走进程级 writeHead 拦截

- 状态：已采纳（2026-09-23）
- 背景事件：GUI（含 tailnet 远程访问）每次刷新重复传输 ~1.4MB JS/CSS；
  排查发现 dsh 前端 dist 全部内容哈希命名，`dsh-host-frontend-static`
  却只写 `content-type`，无缓存头；`/plugins/*` 已由 core 自带 immutable。

## 决策

新增 `@dsh-plus/web-cache-headers`：进程级补丁
`http.ServerResponse.prototype.writeHead`，对 `/assets/` 前缀的 GET/HEAD 200
响应（且未带 cache-control）增量补
`Cache-Control: public, max-age=31536000, immutable`。

**否决：注册 `/assets` 前缀路由自行服务文件**——需复制 core 的文件服务逻辑
（穿越防护/MIME/HEAD/gzip 交互）并硬解 dist 路径；core 未来注册同名路由会
throw 撞车。

## 理由（维护成本对比）

| 维度 | writeHead 拦截（采纳） | 前缀路由自服务（否决） |
|---|---|---|
| dsh 服务耦合 | 无（inject 为空） | webServer 服务 + dist 包布局 |
| 路由撞车风险 | 无（零注册） | core 未来注册 `/assets` 即 throw |
| core 文件服务变更 | 无需同步 | MIME/语义漂移需跟版 |
| 共存性 | 已有 cache-control 自动跳过 | 需自行处理双策略 |

唯一耦合点：`/assets/` 路径约定（Vite 产物结构，固化于 index.html 引用）与
core 经 writeHead 写响应（node:http 统一用法）。两者稳定性远高于路由表与
服务形态。

## 底线保障

- 纯增量、已有头优先：dsh 升级自带策略时自动共存；
- 状态仅 200、方法仅 GET/HEAD：错误与写操作永不缓存；
- 决策异常隔离，绝不阻断响应写入；
- `enabled=false`（settings 热生效）即时恢复原生行为；
- `NODE_ENV=development` 恒禁用，保护 dev/HMR same-URL 热更新；
- 引用计数 + dispose 还原，live reload 无叠加泄漏。

## 后果

- 日常刷新 `/assets/*` 命中磁盘缓存，GUI shell 加载显著加快（本机与
  tailnet 均受益）；
- 会话数据加载不在本 ADR 范围，另行排查；
- 上游若原生支持（建议向 deepseek-harness 提 issue），本插件 `enabled=false`
  退役，零代码变更。
