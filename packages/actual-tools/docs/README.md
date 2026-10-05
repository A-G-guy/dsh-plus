---
last_modified: "2026-10-06 01:55"
description: "@dsh-plus/actual-tools：仅被 actual 预设挂载的 DSH 工具包装（写确认策略、环境快照、CLI 兜底）"
type: fact
---

# @dsh-plus/actual-tools 文档索引

Actual Budget 子插件：**仅被 `actual` 预设挂载**，把主插件
（`@dsh-plus/actual`）发现的能力清单 1:1 包装为 **agent 作用域**的 DSH
工具——预设外完全不可见，不污染其他预设。

> 预设的完整工具目录 = 本插件包装的全部 Actual 派生工具（官方 CLI 的 12 个族
> 外加伴侣 CLI 声明的 `report`/`dashboard`/`reference` 三族）+ `auxTools` 时官方挂载的三行
> 辅助工具（web_search/web_fetch、ask_user_question、todo_write）。
> 辅助行不经本插件的审批链路（`owned` 不含，交还瀑布，与 standard 预设行为
> 一致）；Actual 的族名（`accounts`/`query`/`tags`/`server`/`report`/`dashboard`/`reference`…）与辅助工具
> 无重名，且主插件 `namePrefix` 默认 `actual_`，因此不需要思源那套
> `effectiveDeny` 让位机制。

## 行为

### 工具包装（薄胶水）

- **MCP 条目**（主源）：经官方 `createMcpToolDefinition`
  （`@deepseek-ai/dsh-mcp-client` 导出）适配——名称、描述、JSON Schema 逐字
  透传，canonical 输出、镜像投影、`isError` 语义全部沿用官方实现；
- **降级条目**（MCP 会话不可用时的 CLI help 树目录）：裸 `ToolDefinition`——
  `parameters` = help 树派生的原始 Schema（`additionalProperties: false`），
  执行时先 `validateJsonSchemaValue` 自校验，`--format json` 输出作 canonical 值，
  经 `formatToolValue` 渲染（字符串原样 / 其余 pretty JSON / 空输出占位）；
- **命名**：`namePrefix`（默认 `actual_`）+ 裸族名（`actual_accounts`、
  `actual_query`、`actual_category-groups`）；
- **换代**：清单签名（含 `source`）一致则跳过；变化则整代 dispose 后同步重建
  （模型侧不会出现半代目录）；单条注册冲突只丢弃该条并记 error。

**两条路径的返回值形状不同，且由 `entry.source` 绑定**：官方适配器要求 `call`
交回 canonical `CallToolResult` 信封，裸 ToolDefinition 则消费原始值。故
`ctx.actual.invoke` 按 `source` 返回对应形状（会话掉线后的 CLI 兜底同样如此），
本包两种注册器原样对接、不做形状转换——转换只会把适配器拒收的风险重新引进来。
渲染统一走 `@dsh-plus/actual` 再导出的 `formatToolValue`，不在此包另写一份。

### 执行

工具 `execute` 统一转调 `ctx.actual.invoke(entry, args, {signal, timeoutMs})`：
MCP `tools/call` 优先，会话不可用且该条目有 CLI 计划时直连 CLI；中止信号与
超时预算双保险（`timeoutMs` 同时声明在 `ToolDefinition.timeoutMs`，交由官方
超时策略执行）。

### 写确认策略（接入 DSH 官方审批体系，非自建门禁）

`tools/pre-execute` 监听（预设作用域 → 只影响本预设的调用）：

1. `confirmWrites: false` → 全部交还瀑布；
2. 非本插件工具（`owned` 映射不含）→ 交还瀑布；
3. 判定（纯函数 `classifyAction`，在 `@dsh-plus/actual-mcp` 中单测钉住）：
   - 工具名 ∈ `alwaysAsk` → **写类**；
   - 有 `action`：∈ `readActions` 白名单 → 读类，否则写类；
   - 无 `action`：族名 ∈ `readTools` → 读类，否则写类（宁多问不漏放）；
   - **唯一豁免**：`transactions` 的 `import` 动作在 `dryRun: true` 时算读类
     ——这是 CLI 自己声明的「仅预览不导入」，其余动作没有等价声明；
4. 写类再看**会话的有效审批策略**（`ctx.approval`：session 覆盖 → 服务配置
   默认 → `ask`）：
   - `ask` → 返回 `{kind:'ask'}`，经官方桥接弹审批窗，附 `displayReason`
     （en/zh）本地化文案；
   - `never`（**完全权限预设** `danger-full-access` 的配对值 / 无人值守）→
     **直接放行**；
   - 审批服务缺席、调用无会话 → 放行。ask 绝不静默降级为拒绝。

理由形如 `确认 Actual accounts action=update：写操作，通过审批后执行。`。

### 没有写前快照（刻意的差异）

思源子插件会在首个写操作前打数据历史快照（思源 kernel 有对应 API）。
**Actual 侧没有等价能力，因此本插件不发明假备份**——写入保护由三件事承担：
DSH 审批、提示词里对 `transactions import` 先跑 `dryRun` 的指引、以及服务端
自身的同步历史与官方客户端自带的历史。这一差异在此显式记录，以免被误读为
遗漏。

### 环境快照

注册 `system-prompt` 动态 context（`actual:env`，排序位 130，在官方
sandbox/approval/subagent 快照之后）：CLI 来源与版本、服务端地址与版本、
MCP 会话状态（`connected` / `degraded to CLI`）、版本一致性
（`versions aligned` / `VERSION MISMATCH … report it if a call fails` /
`version unknown`）、本地日期、最近错误（已脱敏）。
`includeRuntimeContext: false` 时官方注册表整体丢弃该快照。

### 生命周期

- `inject: ['actual', 'tools']`：宿主服务缺席（主插件禁用）时按「等待服务」
  挂起，服务出现即激活；
- `apply` 先同步挂好监听/策略/快照与 `ctx.effect` 清理，再等待首次发现
  （自吞失败 → warn + 5s→60s 退避重试），因此**首次发现失败不影响预设激活**；
- 清单变更经 `ctx.actual.onChange` 触发重同步；fiber 卸载时注销工具、退订、
  清定时器。

## 配置（由预设定义下发，行级 schemastery）

| 字段 | 默认 | 说明 |
|---|---|---|
| `toolCallTimeoutMs` | `60000` | 单次调用超时（毫秒） |
| `confirmWrites` | `true` | 非读操作经 DSH 审批策略确认（`ask` 弹窗，`never` 自动通过） |
| `readActions` | 见 `@dsh-plus/actual-mcp` 的 `DEFAULT_READ_ACTIONS` | 读动作白名单 |
| `alwaysAsk` | 见 `DEFAULT_ALWAYS_ASK`（默认空） | 整工具强制确认名单 |
| `readTools` | 见 `DEFAULT_READ_TOOLS`（默认空，故 `sync` 属写侧） | 无 action 属性时按族名判读 |
| `namePrefix` | `actual_` | 模型可见工具名前缀 |

## 契约

- 运行时依赖 `@dsh-plus/actual`（类型、判定默认值与 `ClassifySettings`）与
  官方 `dsh-tools` / `dsh-mcp-client`（peer，宿主提供）；
- 不 `provide` 任何服务（预设激活审计零泄漏）；
- 模块划分：`register.ts`（定义构造与换代）、`policy.ts`（判定集合 + 审批策略
  接入）、`env.ts`（环境快照文本）、`config.ts`、`index.ts`（生命周期编排）。

## 测试

`tests/{policy,register,env,index}.test.ts`：判定矩阵（读/写/alwaysAsk/
无 action/dryRun 豁免/未知动作落写侧）、审批策略矩阵（ask 弹窗 / never 自动
通过 / 无服务不静默拒绝 / 非本插件工具让路）、两类来源的定义构造与入参校验、
换代与来源变化与冲突降级、环境快照文本与注册退订、`apply` 全生命周期
（含降级清单与失败退避）。全部离线零费用；`python3 scripts/dshctl.py test`
一键运行。
