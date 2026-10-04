---
last_modified: "2026-10-04 16:31"
description: "@dsh-plus/siyuan 文档索引"
type: fact
---

# @dsh-plus/siyuan 文档索引

思源笔记（SiYuan）主插件：**能力发现服务（`ctx.siyuan`）+ `siyuan` agent 预设注册**。
宿主行只提供服务与预设声明，**不注册任何模型面工具**——工具由预设挂载的
子插件 `@dsh-plus/siyuan-tools` 在 agent 作用域注册，仅 `siyuan` 预设可见，
不污染其他预设。

## 背景（为什么自动派生）

手工维护「思源笔记能做什么、工具描述怎么写」会迅速失维护积极性、与版本
脱节、遗漏能力。本插件从**本机安装**自动读取两份事实源：

- **MCP 主源**：`POST <endpoint>/mcp`（Streamable HTTP，官方
  `@modelcontextprotocol/client` SDK）的 `tools/list` —— 30 个能力的名称、
  描述与 JSON Schema 逐字取自服务端，`list_changed` 订阅保证版本漂移自动换代；
- **CLI 交叉源**：`kernel --help` / `kernel <family> --help` 的 cobra help 树
  （docker 形态即 `docker exec <容器> /opt/siyuan/kernel …`）——用于能力
  交叉校验（drift 报告）与 MCP 不可达时的降级发现/执行。

两源均来自同一份本机安装，天然版本匹配，零手工清单。

## 架构与数据流

```
主插件 apply
 ├─ ctx.plugin(SiyuanService)          宿主 realm 提供 ctx.siyuan
 │    ├─ resolveConnection()           docker / native / http 三形态 + token 自动读取
 │    ├─ discover()  单飞
 │    │    ├─ MCP 正路：connect → tools/list → help 树交叉校验 → 兜底计划附着 → drift
 │    │    └─ MCP 失败：CLI 降级 → help 树（家族 + action 级）派生 CLI 原生能力
 │    └─ invoke()    MCP tools/call 优先；连接失联且有 CLI 计划时 docker exec 兜底
 └─ ctx.agentPresets.register(         预设声明（id=siyuan）
      persona(complete) + siyuan-tools 行（安全/超时/前缀策略下发）
      + auxTools 时的 tool-web / tool-ask-user / tool-todo 三行辅助工具)
        └─ 子插件（预设作用域）→ ctx.tools.register 一个个能力 1:1 的 DSH 工具
```

- **发现单飞**：并发 `discover()` 共享同一次执行；产出经签名去重后经
  `onChange` 推送，子插件整代换新（同步换代，模型侧无半代目录）。
- **兜底计划**：MCP 能力同时尝试映射到 CLI（action 同名 → snake→kebab →
  显式差异表 `delete→remove`、`search_docs→search`；`sql` 位置参数
  `stmt→<statement>`）；无法完整映射的能力记入 `drift.unmapped`，失联时
  明确报错而非静默失败。
- **降级语义**：仅当 MCP 连接不可用且容器/CLI 存在时才降级（日志告警
  「与运行中的服务并发写存在风险」）；MCP 存活时的单次调用失败**不**触发
  降级（服务在线时并发写风险不可接受），先探测端点再决定。
- **重连**：1s→30s 指数退避，连续 10 次放弃并记一次 error（恢复后
  `/reload` 或重装触发）；成功发现即重置预算。

## 预设契约

`siyuanPresetDefinition(config)` 纯函数（单测钉住）：

| 字段 | 值 |
|---|---|
| `id` | `siyuan`（注册表身份，不开放覆盖） |
| `plugins` | `@deepseek-ai/dsh-persona`（`complete: true`）+ `@dsh-plus/siyuan-tools`；`auxTools`（默认开）时另挂三行**辅助**工具 `tool-web`（web_search/web_fetch）、`tool-ask-user`、`tool-todo` |
| 工具目录 | 操作面只有自动派生的思源能力（MCP × CLI）：不挂 bash/fs/edit/write/skill/subagent/plan/compaction 等操作类官方行；辅助行均不改动笔记数据，不扩大操作范围 |
| 系统提示词 | 默认见 `src/prompt.ts`：静态 persona（`complete: true` 下即完整提示词，`personaPrefix` 可整体覆盖）。**不复述工具描述**——动作/参数用法一律以派生描述为唯一权威，提示词只写跨工具领域语义、响应规范、笔记内容书写规范与安全规则；引用的族名×动作由 `tests/prompt.test.ts` 对照记录版 MCP 清单钉住，防过时失效。官方工具提示段（如 `tool:web_search`）在 complete 模式下被丢弃，其指引（web 不可信+引用来源、ask/todo 行为）由 persona 对应行承接 |
| 运行时上下文 | `includeRuntimeContext: true`（日期/环境/审批策略快照；子插件另注册 `siyuan:env` 快照） |

预设注册沿用 `agent-preset-chat` 先例：惰性 inject `agentPresets`（服务缺席
即空转）、effect 内后台 `register()`、失败仅 warn、`disposed` 守卫防卸载竞态。

## 连接与 token 自动发现

`mode: auto` 判定：`docker ps` 有 SiYuan 容器 → `docker`；显式 `cliCommand`
→ `native`；否则 `http`。

| 形态 | MCP 端点 | CLI 前缀 | token 来源（优先级降序） |
|---|---|---|---|
| docker | `endpoint`（默认 `http://127.0.0.1:6806`，端点 `/mcp`） | `docker exec <容器> /opt/siyuan/kernel` | `config.token` → 容器内 `<工作区>/conf/conf.json` 的 `api.token` → `env.SIYUAN_TOKEN` |
| native | 同上 | `config.cliCommand` | `config.token` → `env.SIYUAN_TOKEN` → `<工作区>/conf/conf.json` |
| http | 同上 | 无（不可兜底） | `config.token` → `env.SIYUAN_TOKEN` |

**token 安全**：仅进 MCP 鉴权头与 docker exec 读取链路；日志/状态/错误文本
经 `sanitize` 强制脱敏（出现即替换 `***`），绝不进提示词、消息流与工具输出。

## 配置（行级 schemastery，patch 可覆盖）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关（false = 不注册预设、不提供服务） |
| `name` / `description` / `order` | `思源笔记` / 见源码 / `10` | 预设显示面 |
| `mode` | `auto` | `auto` \| `docker` \| `native` \| `http` |
| `endpoint` | `http://127.0.0.1:6806` | HTTP 基址（`/mcp`、`/api/system/version` 由此拼接） |
| `container` | `''` | docker 容器名（空 = 名称/镜像含 siyuan 自动挑选） |
| `cliCommand` | `[]` | native 形态 kernel 命令；空 = 无 CLI 兜底 |
| `cliWorkspace` | `''` | `kernel -w` 工作区（空 = docker `/siyuan/workspace`，native `~/SiYuan`） |
| `token` | `''` | 显式 token；空 = 自动发现（支持 `!!js process.env.SIYUAN_TOKEN`） |
| `allow` / `deny` | `[]` / `[]` | 工具暴露白名单（空=全量）/ 黑名单（优先）；生效黑名单见 `effectiveDeny` |
| `auxTools` | `true` | 挂载辅助行 web_search/web_fetch + ask_user_question + todo_write；开启且 `namePrefix` 为空时，派生侧思源自带 `web_search`/`web_fetch`（Exa 版）被注入 `effectiveDeny` 让位（重名免注册期竞态）——关闭则其恢复暴露，且建议同步用 `personaPrefix` 覆盖提示词中对应行 |
| `personaPrefix` | `''` | 覆盖系统提示词（空 = 内置思源优化版） |
| `includeRuntimeContext` | `true` | 运行时上下文快照开关 |
| `confirmWrites` | `true` | 非读操作经 DSH 审批策略确认（`ask` 弹窗 / `never` 完全权限自动通过） |
| `snapshotBeforeWrite` | `true` | 首个本地写操作前打数据历史快照（每会话一次，官方 fail-closed） |
| `snapshotFailure` | `'abort'` | 快照失败处置：`abort` 中止写入 / `warn` 放行告警 |
| `readActions` / `alwaysAsk` / `readTools` | 见 `src/config.ts` | 判读白名单 / 整工具强制确认 / 无 action 工具判读 |
| `toolCallTimeoutMs` | `60000` | 单次调用超时 |
| `namePrefix` | `''` | 模型可见工具名前缀 |

## 服务契约（子插件与测试消费）

`ctx.siyuan`（`SiyuanService`，宿主 realm）：

- `discover(): Promise<SiyuanManifest>` —— 单飞；失败抛错由调用方告警；
- `manifest(): SiyuanManifest | undefined` —— 最近一次成功清单；
- `invoke(entry, args, {signal?, timeoutMs}): Promise<unknown>` —— MCP 优先、
  CLI 兜底；中止信号原样透传；
- `snapshot(memo, {signal?, timeoutMs}): Promise<unknown>` —— 数据历史快照
  （`repo.create`，与思源内置 agent 同 API）；查**未过滤清单**，不受
  allow/deny 暴露过滤影响，失败抛错；
- `onChange(cb): () => void` —— 清单变更订阅（返回退订）；
- `status(): SiyuanStatus` —— 已脱敏的连接事实。

清单/连接类型（`CapabilityEntry`、`CliPlan`、`SiyuanManifest` 等）定义在
`src/contract.ts`，经包入口导出，是主/子插件的唯一契约面。

## 数据安全

- 生产实例只做只读元数据探测（`version`/`tools/list`/`--help`）；一切写与
  功能测试在一次性 scratch 容器上进行（见子插件文档「验证」）；
- 写确认**接入 DSH 官方审批体系**（`ctx.approval`）：会话审批策略 `ask`
  时经 `tools/pre-execute` → `{kind:'ask'}` 弹审批窗（带 en/zh
  `displayReason`）；`never`（完全权限预设 / 无人值守）直接放行；审批服务
  缺席也放行——ask 绝不静默降级为拒绝；读动作白名单免确认；
- **写前数据历史快照**（对齐思源内置 agent）：确认之后、执行之前，每会话
  最多一次 `repo.create`（`DSH agent auto snapshot (dsh-plus)`）；快照失败
  默认中止写入并给出启用「数据历史」指引（`snapshotFailure: 'warn'` 可改为
  放行告警），`snapshotBeforeWrite: false` 可整体关闭；
- 降级 CLI 执行显式告警并发写风险，可经停用 CLI（`mode: http` 或清空
  `cliCommand`/docker）关闭该路径。

## 失败模式

| 场景 | 行为 |
|---|---|
| SiYuan 宕机 / token 缺失 | 预设照常注册；子插件告警 + 5s→60s 退避重试；双源均不可用时 `discover()` 抛 `SiYuan 不可达：…` |
| 预设激活失败（包缺失） | 名册保留诊断，修复 bundle 重装；现有会话不受影响 |
| 能力版本漂移 | `list_changed` 订阅重发现 + 整代换新；drift 报告 MCP-only/CLI-only/无兜底 |
| 单条注册冲突 | 仅丢弃该条并记 error，其余照常 |
| 派生 web 工具与官方辅助工具重名 | `effectiveDeny` 在暴露过滤阶段即让位（aux 开且无前缀），不进注册期；`namePrefix≠''` 或 `auxTools=false` 时无冲突 |
| 端点 401（token 轮换） | 每次发现重新解析连接（docker exec 重读 conf） |
| 审批策略 `never` / 审批服务缺席 | 写操作直接放行（完全权限语义），不产生 `the user rejected tool` 误拒 |
| 数据历史未启用 / 快照失败 | 默认中止该次写入并给出启用指引；可 `snapshotFailure: 'warn'` 或关 `snapshotBeforeWrite` |

## 测试与文档

- 单测：`tests/{help,cli-map,connection,config,definition,prompt,runtime}.test.ts`
  —— help 解析、双源映射与 argv 构造、连接矩阵、生效黑名单、预设组装、
  提示词不变量（含族名×动作防过时校验）、运行时健康/降级/过滤/执行路径/
  快照（全部离线，fixture = 录制的 tools/list 与 cobra help，纯产品元数据）。
- 运行 `python3 scripts/dshctl.py test` 覆盖 lint/typecheck/build/单测。
- 子插件（工具包装与安全策略）见 [siyuan-tools 文档](../../siyuan-tools/docs/README.md)。
