---
last_modified: "2026-08-17 14:20"
---

# @dsh-custom/subagent-model 文档索引

子代理独立模型配置插件：为 `subagent` / `subagent_fork`（及同 provider 名下的其他子代理
委托）单独指定 LLM 提供商、模型与思考程度（reasoningEffort），或选择从主代理继承。
只负责模型选定，maxTokens / persona / toolFilter / maxDepth 等其余参数保持 dsh 原生行为。
配置 UI 位于 webui「设置 → 插件 → 插件配置」，持久化到 `$DSH_HOME/settings.yaml` 并热生效。

## 配置项（settings namespace `dsh-custom-subagent-model`）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | false | 总开关 |
| `entries` | dict | {} | 按**子代理 provider 名**键控（`spawn` / `fork` / …） |
| `entries.<name>.enabled` | boolean | false | 该行开关 |
| `entries.<name>.provider` | string | '' | LLM 提供商 id；空 = 继承主代理 |
| `entries.<name>.model` | string | '' | 模型 id；空 = 继承主代理 |
| `entries.<name>.reasoningEffort` | string | `inherit` | `inherit`（继承）/ `default`（跟随模型默认）/ 目录档位 id |

standard preset 的映射事实：`spawn` ↔ `subagent` 工具、`fork` ↔ `subagent_fork` 工具。

## 运行机制

子代理的模型由**创建时**的 `AgentOptions` 决定（父 options 快照 + 显式
`agentOptions`，后者胜出）；子代理不经 api-proxy 的 create/resume setup，
不安装模型 selection，`agent/request` 瀑布默认无人覆盖。插件据此：

1. 包装 `ctx.subagents.start` / `startContinuable`：按 provider 名命中条目，
   向委托请求注入 `agentOptions = { provider, model, reasoningEffort }`。
   已有显式工具行 `agentOptions`（部署级配置）时**工具行优先**，插件只补空缺。
2. `reasoningEffort` 不在 AgentOptions 的原生读取路径上：以私有字段随
   `agentOptions` 抵达子代理 `options`，再由根 ctx 的 `agent/request` 瀑布
   监听器应用（仅对 `session.header.origin === 'subagent'` 的会话生效）：
   - `inherit`：不干预（fork 子代经会话 seed 天然继承主代理档位）；
   - `default`：显式剥离任何推导出的 effort（跟随模型默认）；
   - 具体档位：显式覆盖。

冷恢复（continuable 子代理重启后续跑）：descriptor 持久化
`agentProvider/agentModel`（来自注入的 agentOptions），恢复后模型保持；
思考档位经会话日志的 request/header 保留，与热路径结果一致。

## 边界

- 未配置 / 总开关关闭：完全原生行为（子代理继承主代理创建时的快照）。
- 条目指向已下线的提供商/模型：子代理首次请求按原生错误路径报错（LlmError）。
- 嵌套子代理：每层委托都经包装，按 provider 名命中（工具实例语义）；
  已配置子代理再委托时，其子代默认继承该配置。
- 同 provider 的 `ralph` 等委托同样受条目影响（机制使然）；
  `workflow` 脚本显式 provider/model 经合并顺序仍优先。
- 服务端 HTTP 通道：`GET/PUT /dsh-custom/subagent-model/config`、
  `GET /dsh-custom/subagent-model/catalog`（官方 settings RPC 白名单不含第三方
  namespace，自建同源路由，读写仍走 `ctx.settings` 用户层）。

## 部署

`pnpm pack` 产出 tarball 后 `dsh plugin --profile web add <tarball>` 安装
（或经 `@dsh-custom/bundle-main` 聚合闭包一并安装），重启 dsh web 后生效。
