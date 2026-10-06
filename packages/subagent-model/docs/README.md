---
last_modified: "2026-10-07 00:39"
description: "@dsh-plus/subagent-model"
type: fact
---

# @dsh-plus/subagent-model

为子代理（`subagent` / `subagent_fork` 等）按 provider 名配置 LLM 提供商、模型与思考程度（reasoningEffort），或选择从主代理继承；`default` 条目可让 spawn/fork 共享同一路由。只负责模型选定，其余参数（maxTokens/persona/toolFilter/maxDepth 等）保持 dsh 原生行为。

## 背景：为什么需要它

官方 `subagent-model-selection`（服务端 settings 命名空间 + 工具行 `modelSelectionSettings: true`，客户端卡片为 `dsh-client-ui-settings-subagent`「子代理模型」）提供的是**主代理可选的模型白名单**：主代理在工具调用里显式传 provider/model 时按白名单校验，但**不强制**任何模型——主代理未显式选择时，子代理默认继承主代理路由（`resolveChildAgentOptions` 的父快照）。因此"配置了官方白名单但子代理依旧用主代理模型"是官方机制的设计行为，不是配置错误。

本插件补的是**管理端强制默认路由**：主代理未显式选择时，按 provider 名注入 `request.agentOptions`（provider/model/reasoningEffort）；主代理显式选择的路由仍优先（只补空缺，不覆盖）。

## 安装与注册

已登记进 `@dsh-plus/bundle-main` 聚合层（生产 profile 随 bundle 加载）。

## 配置

配置 UI：侧边栏「插件」页里本行的「配置」页（`plugins.row.config` /
`plugins.bundle.config` 两槽位；提供商/模型/思考档位下拉数据来自 host 同源
「模型目录」端点 `/dsh-plus/subagent-model/catalog`）。与官方「子代理模型」卡片
（主代理侧白名单）并存不冲突。

settings 命名空间 `dsh-plus-subagent-model`（用户层＝profile 行级覆盖层 `cordis.patch.yml`，热生效）：

```yaml
dsh-plus-subagent-model:
  enabled: true
  entries:
    # 特殊键：未命中具体 provider 名时兜底（spawn/fork 共享同一路由的便捷写法）
    default:
      enabled: true
      provider: newapi-chatds
      model: deepseek-v4-flash
      reasoningEffort: inherit
    # 具体 provider 名（standard preset 事实映射：subagent↔spawn、subagent_fork↔fork）
    spawn:
      enabled: true
      provider: newapi-chatds
      model: deepseek-v4-pro
      reasoningEffort: high
    fork:
      enabled: false
```

字段语义：

| 字段 | 取值 | 含义 |
|---|---|---|
| `enabled` | `true`/`false` | 该行开关 |
| `provider` / `model` | 提供商/模型 id | 留空 = 继承主代理；model 不能脱离 provider 单独配置 |
| `reasoningEffort` | `inherit` / `default` / 档位 id | `inherit` 继承主代理（默认）；`default` 显式剥离任何继承/推导的 effort，跟随所选模型默认；其余为提供商目录档位 id（如 `max`/`high`） |

校验规则：model 非空时 provider 必填；reasoningEffort 非空。非法写入被 settings validate 钩子拒绝。

## 与官方白名单的配合建议

- 官方 `subagent-model-selection.allowedModels` 是主代理**显式选择**时的合法路由集合；本插件的条目是**未选择时**的默认路由。两者互不冲突。
- 若希望"显式选择也必须落在某条路由"，把该路由同时加进官方白名单。
- 本插件注入的默认路由不经过官方白名单校验（那是主代理显式选择的闸门）；如需白名单语义兜底，可把默认路由也列入 `allowedModels`。

## 机制

包装 `ctx.subagents.start` / `startContinuable`（幂等 + dispose 恢复），按 provider 名命中条目（未命中回落 `default`）后向委托请求注入 `agentOptions`。平台的 `resolveChildAgentOptions(parent, request.agentOptions, childDepth)` 原生读取 provider/model/reasoningEffort（热路径与冷恢复 descriptor 一致），故只需注入这两个字段、无需搬运任何私有字段。

## 与官方能力的分工（勿误判为可删）

0.2.1-alpha.1 复核：官方 `dsh-client-ui-settings-subagent` 与 `dsh-subagent` 在**请求期**的 provider/model/reasoningEffort 选择仍在，但它们只覆盖「主代理显式选择」这条路径；**未选择时的强制默认**仍是官方缺口，由本插件补。删除本插件会退回"子代理继承主代理模型"的官方默认行为。

## 测试

```bash
node --test packages/subagent-model/tests/*.test.ts
```
