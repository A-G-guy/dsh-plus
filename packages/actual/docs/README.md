---
last_modified: "2026-10-05 04:17"
description: "@dsh-plus/actual：Actual Budget 能力发现主插件与 actual agent 预设的契约、配置项与部署方式"
type: fact
---

# @dsh-plus/actual 文档索引

Actual Budget 主插件：**能力发现服务 + `actual` agent 预设注册**。

宿主行只 `provide` `ctx.actual` 服务与预设声明，**不注册任何模型面工具**——
工具由预设挂载的子插件（`@dsh-plus/actual-tools`）在 agent 作用域注册，
其他预设完全不受影响。格式一（MCP 服务）在这里被真实使用：进程内挂载
`@dsh-plus/actual-mcp` 的服务端，DSH 工具从它的 `tools/list` 派生。

## 发现流程（`src/runtime.ts`）

```
discover()
  ├─ resolveCli          候选解析 + `actual --version` 探针
  ├─ collectHelpTree     root / 族 / 动作三级 `--help`（有界并发 8、预算 30s）
  ├─ buildCatalog        help 树 → 能力条目（含 cli 执行计划）
  ├─ probeServerVersion  <serverUrl>/info 的 build.version
  ├─ assertVersionPolicy major.minor 不一致 → 告警 或（strict）硬失败
  ├─ replaceSession      进程内 MCP 服务端 + 客户端（InMemoryTransport）
  ├─ session.listTools   ← 格式二的能力来源
  ├─ computeDrift        MCP × CLI help 树交叉校验
  └─ publish             过滤 allow/deny → 清单 + 通知订阅者
```

**双源与降级**：MCP `tools/list` 为主源（`source: 'mixed'`）；会话建立不起来
时降级为 CLI help 树目录（`source: 'cli'`），此时子插件改注册裸
ToolDefinition，执行面仍是同一条 CLI 链路，**可用性不受影响**。

**执行**：`invoke` 在 MCP 会话可用时走 `tools/call`，会话不可用时按条目自带的
`cli` 计划直连。工具失败已由 MCP 服务端表示为 `isError` 结果并转成异常，因此
**绝不重放**——写操作重放会造成重复记账。

**发现失败**：`discover()` 单飞；失败记 `lastError`（已脱敏）并按
1s→30s 指数退避重连，连续 10 次后放弃一次告警，等待 `/reload` 触发。

## 预设声明（`src/definition.ts`）

预设 `plugins` 只挂四类行：

| 行 | 作用 |
|---|---|
| `persona`（`complete: true`） | Actual 定制系统提示词，移除 harness 身份/Web 定向/技能/目标等无关注入 |
| `actual-tools` | 唯一操作面：Actual 派生工具 + 写确认策略 |
| `tool-web` / `tool-ask-user` / `tool-todo`（`auxTools` 时） | 辅助工具，不改动预算数据 |

**不挂** bash / pwsh / fs / fs-search / skill / goal / plan-mode / subagent /
workflow / jobs / code-runtime 等操作类官方行——预设的组合树即「剔除无关工具」
的机制本身。

提示词（`src/prompt.ts`）只写**跨工具语义**（金额一律整数分、拆分父子行与
`is_parent` 过滤、AQL 无日期子字段、服务端只是 CRDT 中继、每次调用新建连接
故忌密集连发）与行为规范，不复述任何工具的动作/参数用法；引用的族名 × 动作
由 `tests/prompt.test.ts` 按 fixture 钉住，防漂移。

## 配置卡片（浏览器半，`@dsh-plus/actual/client`）

插件页的「Actual Budget 连接」卡片（`plugins.row.config` / `plugins.bundle.config`
两槽位，经共享层 `injectPluginConfigCard` 注册）——**非密钥字段可在 GUI 直接改**，
写入用户层即热生效：

- 全字段 `.volatile()`：条目进入 settings describe 视图，loader 原位提交活动引用；
  消费端（`service.ts`）以 `current()` 现取即热，**连接相关字段变化时重建运行时**
  并按新配置重新发现（CLI 绑定、服务端地址、预算、超时都参与 CLI 进程构造，
  只换值不重建会让新旧配置混用）；
- 卡片可编辑：`enabled` / `serverUrl` / `syncId` / `cliCommand`（空格分隔 argv，
  空 = 自动探测）/ `cliVersionPolicy` / `confirmWrites` / `auxTools` / `namePrefix`；
- 表单校验在 `client/draft.ts`（纯函数，`node --test` 直接测）：地址须为完整
  `http(s)://`，`cliCommand` **不支持引号**（不做 shell 解析，带引号即判非法，
  避免"看起来支持、实际把引号当参数一部分"的静默错配），前缀限 `[A-Za-z0-9_-]`；
  有未通过项时保存按钮禁用。

**密钥故意没有编辑器**：`password` / `sessionToken` / `encryptionPassword` 标
`.role('secret')`，describe 视图剥除其值、写入用户层也会被遮蔽——给输入框等于
让用户白填。卡片内直接给出落点与可复制的 patch 片段（口令本体放进程环境变量，
或走官方 CLI 的 `ACTUAL_PASSWORD_FILE`）。这一取舍与
[web-search-services](../../web-search-services/docs/README.md) 一致。

## 配置（行级 schemastery）

GUI 覆盖不到的字段见卡片内的「其余字段」说明；密钥与部署方旋钮一律由 profile 的
`cordis.patch.yml` 覆盖，推荐用 `!!js process.env.…` 从环境注入。

| 字段 | 默认 | 卡片 | 说明 |
|---|---|---|---|
| `enabled` | `true` | ✅ | 总开关（false = 不注册预设，等价未安装） |
| `name` / `description` / `order` | `Actual Budget` / … / `11` | — | 预设卡片显示面 |
| `serverUrl` | `http://127.0.0.1:5006` | ✅ | 同步服务器基址；服务端版本探测 `<serverUrl>/info` |
| `password` | `''` | 密钥 | 服务器口令（空 = 用 `ACTUAL_PASSWORD` / `ACTUAL_PASSWORD_FILE`） |
| `sessionToken` | `''` | 密钥 | 会话令牌，优先于 `password`（空 = 用 `ACTUAL_SESSION_TOKEN`） |
| `encryptionPassword` | `''` | 密钥 | 端到端加密口令（仅加密预算需要） |
| `syncId` | `''` | ✅ | 预算 Sync ID（空 = 用 `ACTUAL_SYNC_ID`；多数命令必需） |
| `dataDir` | `''` → 插件数据目录 `cli-data` | — | CLI 本地缓存目录，与用户自有 CLI 隔离 |
| `cacheTtl` / `lockTimeout` | `60` / `10` | — | 官方 CLI 同名参数（秒） |
| `cliCommand` | `[]` | ✅ | CLI argv 前缀；空 = 自动（`ACTUAL_CLI` → PATH → 包内） |
| `cliVersionPolicy` | `'warn'` | ✅ | `warn` 告警继续 / `strict` 发现直接失败 |
| `allow` / `deny` | `[]` | — | 工具暴露白/黑名单（裸族名，deny 优先） |
| `auxTools` | `true` | ✅ | 是否挂三行辅助工具 |
| `personaPrefix` | `''` | — | 覆盖系统提示词（空 = 内置 Actual 优化版） |
| `includeRuntimeContext` | `true` | — | 是否注入运行时上下文快照 |
| `confirmWrites` | `true` | ✅ | 写操作经 DSH 审批策略确认 |
| `readActions` / `alwaysAsk` / `readTools` | 见 `@dsh-plus/actual-mcp` 的 `classify.ts` | — | 读/写判定名单 |
| `toolCallTimeoutMs` | `60000` | — | 单次工具调用超时（毫秒） |
| `namePrefix` | `actual_` | ✅ | 模型可见工具名前缀（`query`/`server`/`tags` 过于通用，故默认加前缀） |

部署示例：

```yaml
- id: dsh-plus-actual
  name: '@dsh-plus/actual'
  config:
    syncId: !!js process.env.ACTUAL_SYNC_ID
    password: !!js process.env.ACTUAL_PASSWORD
```

## 契约

- 运行时依赖 `@dsh-plus/actual-mcp`（能力派生与 MCP 服务端）、
  `@dsh-plus/shared`（插件数据目录）、`@modelcontextprotocol/client`（进程内会话）；
- peer 依赖：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-agent-preset-registry`、
  `@deepseek-ai/schemastery`（平台包一律 peer + dev 精确版，见 ADR 0001）；
- 对子插件公开：`discover()` / `manifest()` / `invoke()` / `status()` /
  `onChange()`，并 re-export 契约类型与读/写判定默认值；
- 双入口构建（`tsdown.config.ts`，与 web-cache-headers 同约定）：`src/index.ts`
  → `lib/index.js`（ESM + dts，node 半）；`src/client/client.ts` → `lib/client.js`
  （CJS factory bundle，浏览器半，react 由外壳 ModuleLoader 提供）；
- 模块划分：`config.ts`（全字段 volatile 的单一事实源）、`ns.ts`（settings 命名空间）、
  `runtime.ts`（发现与执行核心，I/O 全注入）、`mcp-session.ts`（进程内 MCP 会话）、
  `service.ts`（真实 I/O 装配 + 活动引用热取 + 连接字段变化重建）、`definition.ts`、
  `prompt.ts`、`reconnect.ts`（退避调度）、`index.ts`；浏览器半
  `client/{client.ts,card.tsx,draft.ts,i18n.ts,styles.ts}`。

## 测试

`tests/{runtime,definition,prompt}.test.ts`：

- `runtime` 用真实 help fixture + 替身 MCP 会话覆盖：清单来源与 12 个族、
  每个条目的 CLI 兜底计划、版本策略 warn/strict/unknown 三态、越界与降级
  两条 invoke 路径、allow/deny 过滤、订阅通知与退订、密钥脱敏、dispose 清理、
  CLI 不可用时的错误与重连；
- `definition` 钉住预设只挂预期行（含 auxTools 开关与 persona 覆盖）；
- `prompt` 钉住提示词骨架、无关注入的缺席、不复述工具用法，以及**引用的每个
  动作都真实存在于 help fixture**；
- `draft` 钉住卡片的纯转换与校验：`cliCommand` 文本 ↔ argv 往返、补丁只含本卡片
  字段、地址/引号/前缀三类非法输入的拒绝与放行边界。

`python3 scripts/dshctl.py test` 一键运行。

## 验证（人工）

1. `npm install --location=global @actual-app/cli`（Node ≥ 22），确认
   `actual --version` 与服务器 `/info` 的 `build.version` 一致；
2. 装入 bundle-main 并 `/reload`，在 **设置 → Agent 预设** 出现「Actual Budget」；
3. 新会话选该预设：工具目录 = 12 个 `actual_*` 工具 + 辅助三件套，
   无 bash/fs/edit/skill/subagent 等操作类工具；系统提示词为 Actual 优化版；
4. 只读验证：`actual_server` 的 `version`、`actual_accounts` 的 `list`、
   `actual_query` 的 `tables`；运行时快照里的 CLI/服务端版本应一致；
5. 写操作验证：权限模式为「每次询问」时写调用应弹审批窗、拒绝后无副作用；
   切到完全权限后同一调用直接执行、无弹窗；
6. 断开服务器后新会话应只告警不崩溃，恢复后工具自动补回。
