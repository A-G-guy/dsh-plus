---
last_modified: "2026-09-30 08:51"
---

# @dsh-plus/siyuan-tools 文档索引

思源笔记（SiYuan）子插件：**仅被 `siyuan` 预设挂载**，把主插件
（`@dsh-plus/siyuan`）发现的能力清单 1:1 包装为 **agent 作用域**的 DSH
工具——预设外完全不可见，不污染其他预设。

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

### 写确认策略（对齐思源内置 agent 行为）

`tools/pre-execute` 监听（预设作用域 → 只影响本预设的调用）：

1. `confirmWrites: false` → 全部交还瀑布；
2. 非本插件工具（`owned` 映射不含）→ 交还瀑布；
3. 判定（纯函数 `classifyPolicy`，单测钉住）：
   - 工具名 ∈ `alwaysAsk`（外发/包管理/文件系统面：`sync`、`bazaar`、`file`、
     `http_request`、`web_fetch`、`web_search`、`image`、`import`、`export`、
     `inbox`、`unzip`）→ **ask**（即便该 action 是读类）；
   - 有 `action`：∈ `readActions` 白名单 → 放行，否则 **ask**；
   - 无 `action`：工具名 ∈ `readTools`（默认 `sql`、`search`）→ 放行，
     否则 **ask**（宁多问不漏放）。

`ask` 由官方注册表交 `ctx.approval` 弹审批（缺席时**降级为拒绝**，
fail-closed）。审批理由形如 `确认 SiYuan document action=create：写操作，
通过审批后执行。`——状态先行、理由可执行，对应思源的「写操作 UI 确认、
读操作免确认」。

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
| `confirmWrites` | `true` | 非读操作 ask 确认 |
| `readActions` | 见主插件 `DEFAULT_READ_ACTIONS` | 读动作白名单（`alwaysAsk` 优先） |
| `alwaysAsk` | 见主插件 `DEFAULT_ALWAYS_ASK` | 整工具强制确认名单 |
| `readTools` | `['sql','search']` | 无 action 属性时按工具名判读 |
| `namePrefix` | `''` | 模型可见工具名前缀 |

## 契约

- 运行时依赖 `@dsh-plus/siyuan`（类型 + 判读默认值常量）与官方
  `dsh-tools` / `dsh-mcp-client`（peer，宿主提供）；
- 不 `provide` 任何服务（预设激活审计零泄漏）；
- 模块划分：`register.ts`（定义构造与换代）、`policy.ts`（判定与瀑布）、
  `env.ts`（快照文本）、`index.ts`（生命周期编排）。

## 测试

`tests/{policy,register,env,index}.test.ts`：判定矩阵（读/写/外发/无 action/
非本插件）、CLI/MCP 定义构造与执行（含入参校验）、换代与冲突降级、
快照文本、`apply` 全生命周期（注册 → 策略绑定 → 变更换代 → 清理注销）。
全部离线零费用；`python3 scripts/dshctl.py test` 一键运行。

## 验证（人工，面向生产实例的安全步骤）

1. `dshctl install-prod`（或 `plugin_manager install_bundle`）装入 bundle-main，`/reload` 后在 **设置 → Agent 预设** 出现「思源笔记」；
2. 新会话选该预设：工具目录 = 思源能力集（无 bash/fs/skill 等）；系统提示词为思源优化版；
3. 只读验证仅允许元数据调用（如 `system` 的 `version`/`current_time`）；
   **写操作验证一律在 scratch 容器上进行**（`docker run -d -p 127.0.0.1:16806:6806 -v /tmp/siyuan-it:/siyuan/workspace b3log/siyuan:latest`，端点覆盖指向它，结束后删容器与临时目录），禁止用生产工作区做写测试；
4. 写调用应弹审批、拒绝后无副作用；停掉容器后新会话应只告警不崩溃，恢复容器后工具自动补回。
