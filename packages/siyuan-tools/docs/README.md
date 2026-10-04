---
last_modified: "2026-10-04 16:31"
description: "@dsh-plus/siyuan-tools 文档索引"
type: fact
---

# @dsh-plus/siyuan-tools 文档索引

思源笔记（SiYuan）子插件：**仅被 `siyuan` 预设挂载**，把主插件
（`@dsh-plus/siyuan`）发现的能力清单 1:1 包装为 **agent 作用域**的 DSH
工具——预设外完全不可见，不污染其他预设。

> 预设的完整工具目录 = 本插件的思源派生能力 + `auxTools` 时官方挂载的
> 三行辅助工具（web_search/web_fetch、ask_user_question、todo_write）。
> 辅助行不经本插件的审批/快照链路（`owned` 不含，交还瀑布，与 standard
> 预设行为一致）；派生侧自带的 `web_search`/`web_fetch` 在 `auxTools` 开启
> 且 `namePrefix` 为空时由主插件 `effectiveDeny` 过滤让位（见主插件文档）。

## 行为

### 工具包装（薄胶水）

- **MCP 条目**：经官方 `createMcpToolDefinition`（`@deepseek-ai/dsh-mcp-client`
  导出）适配——名称、描述、JSON Schema 逐字透传，canonical 输出
  `{content, structuredContent}`、镜像投影、`isError` 语义全部沿用官方实现；
  `outputSchema`/`taskRequired` 若上游公告则一并透传。
- **CLI 条目**（降级发现的 CLI 原生能力）：裸 `ToolDefinition`——
  `parameters` = help 树派生的原始 Schema（`additionalProperties: false`），
  执行时先 `validateJsonSchemaValue` 自校验，`-f json` 输出作 canonical 值，
  渲染为字符串原样 / 其余 pretty JSON。
- **命名**：`namePrefix`（默认空）+ 能力原名（与 MCP 工具名、cobra 家族名
  一致，如 `document`、`web_fetch`、`sql`）。
- **换代**：清单签名一致则跳过；变化则整代 dispose 后同步重建（模型侧不会
  出现半代目录）；单条注册冲突只丢弃该条并记 error。

### 执行

工具 `execute` 统一转调 `ctx.siyuan.invoke(entry, args, {signal, timeoutMs})`：
MCP `tools/call` 优先，连接失联且该能力有 CLI 兜底计划时改走
`docker exec … kernel …`（`-f json -w <工作区>`）；中止信号与超时预算
双保险（`timeoutMs` 同时声明在 `ToolDefinition.timeoutMs` 交由官方
超时策略执行）。

### 写确认策略（接入 DSH 官方审批体系，非自建门禁）

`tools/pre-execute` 监听（预设作用域 → 只影响本预设的调用）：

1. `confirmWrites: false` → 全部交还瀑布；
2. 非本插件工具（`owned` 映射不含）→ 交还瀑布；
3. 判定（纯函数 `classifyPolicy`，单测钉住）：
   - 工具名 ∈ `alwaysAsk`（外发/包管理/文件系统面：`sync`、`bazaar`、`file`、
     `http_request`、`web_fetch`、`web_search`、`image`、`import`、`export`、
     `inbox`、`unzip`）→ **写类**（即便该 action 是读类）；
   - 有 `action`：∈ `readActions` 白名单 → 读类，否则写类；
   - 无 `action`：工具名 ∈ `readTools`（默认 `sql`、`search`）→ 读类，
     否则写类（宁多问不漏放）；
4. 写类再看**会话的有效审批策略**（`ctx.approval`：session 覆盖 → 服务配置
   默认 → `ask`）：
   - `ask` → 返回 `{kind:'ask'}`，经官方桥接（`approval.request`）弹审批窗，
     附带 `displayReason`（en/zh）本地化展示文案；
   - `never`（**完全权限预设** `danger-full-access` 的配对值 / 无人值守）→
     **直接放行**——完全权限模式下写操作全部自动通过；
   - 审批服务缺席、调用无会话 → 放行。ask 绝不静默降级为拒绝（盲发 ask 在 `never`
     策略下会被官方桥接判成 `the user rejected tool …` 而用户看不到弹窗，案例见
     [事故记录](../../../docs/repo/事故记录.md)）。

理由形如 `确认 SiYuan document action=move：写操作，通过审批后执行。`——
对应思源的「写操作确认、读操作免确认」，但确认权完全交给 DSH 权限体系。

### 写前数据历史快照（对齐思源内置 agent 的 fail-closed 安全网）

官方内置 agent 在**确认之后、执行之前**对整个会话最多打一次自动快照
（`IndexRepo("AI agent auto snapshot")`，快照失败即中止写入）。本插件同样：

- **执行位置**：工具 `execute` 里、审批放行之后、`invoke` 之前（`beforeWrite`
  钩子）；MCP 与 CLI 两个分支同样挂钩；
- **每会话一次**：插件实例级 `done` 标记（对应官方 `snapshotCreated`）；
- **打什么**：`ctx.siyuan.snapshot(memo)` → `repo` 能力的 `create` 动作——
  与官方 `IndexRepo` 同一 API；查**未过滤清单**，allow/deny 隐藏 `repo`
  也不影响内部安全能力；
- **判定**：`needsSnapshot` 逐行镜像官方 `needsLocalSnapshot`
  （ActionEffects 表 → safeActions/safeWholeTools/safeNative → 作用域表，
  `repo.create` 自身与 External 工具免快照），表值取自同版本（3.8.6）源码；
- **失败处置**：`snapshotFailure: 'abort'`（默认，官方行为：中止本次写入并
  给出启用「数据历史」的指引；本次不记成功，下次写自动重试）或 `'warn'`
  （放行 + 记告警）；`snapshotBeforeWrite: false` 整体关闭。

### 环境快照

注册 `system-prompt` 动态 context（`siyuan:env`，排序位 130，在官方
sandbox/approval/delegation 快照之后）：SiYuan 版本、连接形态与端点、
MCP/CLI 可用性、本地日期、最近错误（已脱敏）。对应思源内置提示词的
`<env>` 块；`includeRuntimeContext: false` 时官方注册表整体丢弃该快照。

### 生命周期

- `inject: ['siyuan', 'tools']`：宿主服务缺席（主插件禁用）时按
  「等待服务」挂起，服务出现即激活；
- `apply` 先同步挂好监听/策略/快照与 `ctx.effect` 清理，再等待首次发现
  （自吞失败 → warn + 5s→60s 退避重试），因此**首次发现失败不影响预设激活**；
- 清单变更经 `ctx.siyuan.onChange` 触发重同步；fiber 卸载时注销工具、
  退订、清定时器。

## 配置（由预设定义下发，行级 schemastery）

| 字段 | 默认 | 说明 |
|---|---|---|
| `toolCallTimeoutMs` | `60000` | 单次调用超时（毫秒） |
| `confirmWrites` | `true` | 非读操作经 DSH 审批策略确认（`ask` 弹窗，`never` 自动通过） |
| `snapshotBeforeWrite` | `true` | 首个本地写操作前打数据历史快照（每会话一次） |
| `snapshotFailure` | `'abort'` | 快照失败处置：`abort` 中止写入（官方行为）/ `warn` 放行告警 |
| `readActions` | 见主插件 `DEFAULT_READ_ACTIONS` | 读动作白名单（`alwaysAsk` 优先） |
| `alwaysAsk` | 见主插件 `DEFAULT_ALWAYS_ASK` | 整工具强制确认名单 |
| `readTools` | `['sql','search']` | 无 action 属性时按工具名判读 |
| `namePrefix` | `''` | 模型可见工具名前缀 |

## 契约

- 运行时依赖 `@dsh-plus/siyuan`（类型 + 判读默认值常量）与官方
  `dsh-tools` / `dsh-mcp-client`（peer，宿主提供）；
- 不 `provide` 任何服务（预设激活审计零泄漏）；
- 模块划分：`register.ts`（定义构造与换代与 beforeWrite 钩子）、`policy.ts`
  （判定 + 审批策略接入）、`snapshot.ts`（写前快照判定与守卫）、
  `env.ts`（快照文本）、`index.ts`（生命周期编排）。

## 测试

`tests/{policy,snapshot,register,env,index}.test.ts`：判定矩阵（读/写/外发/
无 action/非本插件）、审批策略矩阵（ask 弹窗 / never 自动通过 / 无服务不
静默拒绝）、快照判定与守卫（镜像官方规则、每会话一次、失败中止/放行）、
CLI/MCP 定义构造与执行（含入参校验与 beforeWrite 钩子）、换代与冲突降级、
环境快照文本、`apply` 全生命周期。全部离线零费用；
`python3 scripts/dshctl.py test` 一键运行。

## 验证（人工，面向生产实例的安全步骤）

1. `dshctl install-prod`（或 `plugin_manager install_bundle`）装入 bundle-main，`/reload` 后在 **设置 → Agent 预设** 出现「思源笔记」；
2. 新会话选该预设：工具目录 = 思源能力集 + 辅助三件套（`web_search`/`web_fetch`/`ask_user_question`/`todo_write`），无 bash/fs/edit/write/skill 等操作类工具，且无重复的思源版 web 工具；系统提示词为思源优化版（轨迹视图「系统提示词」可核对）；
3. 只读验证仅允许元数据调用（如 `system` 的 `version`/`current_time`）；
   **写操作验证一律在 scratch 容器上进行**（`docker run -d -p 127.0.0.1:16806:6806 -v /tmp/siyuan-it:/siyuan/workspace b3log/siyuan:latest`，端点覆盖指向它，结束后删容器与临时目录），禁止用生产工作区做写测试；
4. 审批行为验证（生产只读结论 + scratch 写结论）：权限模式为「每次询问」时写调用应弹审批窗、拒绝后无副作用；切换**完全权限**（approval=never）后同一写调用应直接执行、无弹窗、无 `the user rejected tool`；
5. 快照验证（scratch 容器）：开启数据历史时首个写调用前应出现 `DSH agent auto snapshot (dsh-plus)` 快照且后续写不再重复打；关闭数据历史（或删 repo key）后写调用应被中止并给出指引；
6. 停掉容器后新会话应只告警不崩溃，恢复容器后工具自动补回。
