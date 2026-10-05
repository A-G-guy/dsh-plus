---
last_modified: "2026-10-06 00:35"
description: "@dsh-plus/actual-mcp：把 @actual-app/cli 按 help 文本运行时封装为 MCP 服务（格式一）的契约、派生规则与可移植用法"
type: fact
---

# @dsh-plus/actual-mcp 文档索引

Actual Budget 能力封装的**格式一**：把本机 `@actual-app/cli` 按 help 文本
运行时自动封装为 **MCP 服务**。零 DSH 依赖，可被任意 MCP 宿主直接运行；
同时是**格式二**（`@dsh-plus/actual-tools` 的 DSH 工具）的唯一能力来源——
主插件在进程内挂载同一个 `createActualMcpServer`，再从 MCP `tools/list`
派生出 DSH 工具。

## 为什么由 help 文本派生

工具目录（命令族 × 动作 × 参数 × 枚举）**不落代码**：每次发现都现场采集
已安装 CLI 的 `--help` 树，因此 CLI 升级即目录升级，不存在「插件里的清单与
实际二进制错位」。唯一无法从 help 得到的是**必填性**——commander 的
`requiredOption` 在 help 里与普通选项同形——因此 schema 全可选，把 CLI 自身
的 `error: required option '--name <name>' not specified`（stderr + exit 1）
原样透出，由模型一轮自纠；**不做硬编码必填表，也不做可能触发副作用的探测**。

## 派生规则（`src/derive.ts`，纯函数，fixture 钉住）

- **有子命令的族 → 一个族工具 + `action` 枚举**（12 个族共 12 个工具；
  外加伴侣 CLI 声明的 `report`/`dashboard` 两族，见
  [adr/0009](../../../docs/repo/adr/0009-伴侣CLI补齐官方缺失的报表与仪表盘能力.md)）；
  枚举值的逐动作短描述拼进 `action.description`，那是 schema 里唯一能承载
  逐动作语义的位置；
- **无子命令的族**（`sync`）→ 直连工具，位置参数进 `required`；
- 选项按 action 求并集：取值选项 → `string`，无占位符 → `boolean`；
  `(choices: …)` 收敛为 `enum`，**逐 action 取值不一致时丢弃 enum**
  （宁可放宽，也不误挡合法取值）；`(default: …)` 从描述剥离后落到 schema；
- 子集出现的属性附 `[used by: list, update]` 注记——commander 不暴露必填性，
  「哪些动作用到它」是 help 能提供的最强线索；
- **同名选项与位置参数按属性名合并**（本 CLI 真有此例：`query run --table`
  与 `query fields <table>`）：标签与动作集求并，执行时按调用级 help 决定
  它是选项还是位置参数；
- 全局选项（`--server-url`/`--password`/`--data-dir`/`--format` 等 13 个）
  **不进任何工具 schema**——它们是部署方旋钮，由执行层经子进程环境统一下发。

## 描述折行

非 TTY 时 commander 的 `helpWidth` 恒为 80（`process.stdout.columns` 为
undefined → `?? 80`），长描述会折到描述列（缩进远大于条目的 2 空格）。
解析器以「缩进恰好 2 且 term 形态匹配」判定新条目，否则拼回当前条目的描述，
因此 help 采集在管道执行下是确定性的。

## MCP 服务端（`src/server.ts`）

- 每条能力经 `registerTool(name, {description, inputSchema: fromJsonSchema(schema),
  annotations}, handler)` 注册；`readOnlyHint` 只在**整工具全为只读动作**时
  置真（保守判定），写工具标 `destructiveHint`；
- 工具失败返回 `isError: true` 的结果并携带 CLI 原文——**不抛协议错误**，
  模型始终能读到真实原因；
- 入参先经 `fromJsonSchema` 校验，越界枚举在触达执行器之前即被拒；
- **成功结果一律是 canonical `CallToolResult` 信封**，由 `callToolResultOf`
  统一构造：单个文本块承载 CLI 输出（字符串原样，其余 pretty JSON）；空输出给
  `(no output)` 占位——空文本在模型侧与「什么都没发生」无法区分。该函数是
  **值→结果的唯一映射处**，主插件的 CLI 兜底也经它构造，因为 DSH 侧
  `source: 'mcp'` 的条目由官方 `createMcpToolDefinition` 注册、其 `call` 必须
  返回信封：裸数组/标量被判 `invalid MCP result`，裸对象渲染成空内容。

## 与 CLI 的边界（`src/cli-run.ts`）

- **密钥只走子进程环境变量**（官方 CLI 原生读 `ACTUAL_PASSWORD` /
  `ACTUAL_SESSION_TOKEN` / `ACTUAL_ENCRYPTION_PASSWORD`，见导出的 `SECRET_ENV`），
  绝不进 argv——否则会经 `ps` 泄漏；错误文本再经 `sanitize` 兜一层
  （当场解析出的密钥一并进入脱敏名单），日志/状态/提示词全脱敏；
- **密钥来源可插拔**：`CliDeps.resolveSecrets` 是宿主凭据 seam 的接线点，在
  `exec` **每次调用**前解析、不跨操作缓存（独立 MCP 进程与测试不注入，退回静态
  配置，密钥仍可由 CLI 自行继承环境）；解析失败按「凭据文件不可用」报错，
  不静默降级成无认证执行；
- **调用串行化**：官方明示「每次调用新建连接、密集连续请求会触发限流或鉴权
  失败」，且 CLI 对预算目录加锁——并发只会自伤；
- **显式候选强约束、自动候选可回退**：解析顺序
  `cliCommand` 配置 → `ACTUAL_CLI` 环境变量（二者失败即报错）→ PATH `actual`
  → PATH `actual-cli` → 包内可解析的 `@actual-app/cli`；全失败给出安装指引；
- **不声明 `@actual-app/cli` 依赖**：它带来约 225MB / 59 包的闭包与一个
  `better-sqlite3` 原生构建（pnpm 默认拒绝其构建脚本，`pnpm install` 会直接
  失败），因此默认探测式，由部署方按官方文档安装，或用 `cliCommand` 指定；
- 数据目录空值 = 交给 CLI 自己的默认（`~/.actual-cli/data`）；主插件会覆盖为
  插件数据目录，避免与用户自有 CLI 的缓存和迁移互相踩。

## 可移植用法（任意 MCP 宿主）

```bash
npm install --location=global @actual-app/cli
ACTUAL_SERVER_URL=http://127.0.0.1:5006 \
ACTUAL_PASSWORD=… \
ACTUAL_SYNC_ID=… \
npx -y @dsh-plus/actual-mcp
```

配置全部走环境变量（MCP 宿主配置服务即配环境变量）：`ACTUAL_SERVER_URL`、
`ACTUAL_PASSWORD`（或 `ACTUAL_SESSION_TOKEN`）、`ACTUAL_SYNC_ID`、
`ACTUAL_DATA_DIR`、`ACTUAL_ENCRYPTION_PASSWORD`、`ACTUAL_CACHE_TTL`、
`ACTUAL_LOCK_TIMEOUT`、`ACTUAL_CLI`、`ACTUAL_TOOL_TIMEOUT_MS`。

DSH 侧同样可以只用格式一（不装 `@dsh-plus/actual`）：

```yaml
- id: mcp-actual
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: actual
    transport: stdio
    command: npx
    args: ['-y', '@dsh-plus/actual-mcp']
    env:
      ACTUAL_SERVER_URL: http://127.0.0.1:5006
      ACTUAL_PASSWORD: !!js process.env.ACTUAL_PASSWORD
      ACTUAL_SYNC_ID: !!js process.env.ACTUAL_SYNC_ID
```

> 工具错误、启动失败只写 stderr：stdio 服务的 stdout 是协议通道，任何非协议
> 输出都会破坏会话。

## 版本相容（CLI × 服务端）

Actual 的服务端是 **CRDT 同步中继**，不做预算逻辑（全部在客户端），两侧
都没有协议版本闸门，官方错误码 `out-of-sync-migrations` 的语义是「文件太旧
才打不开，来自更新版本的文件可正常打开」。因此版本不匹配通常不致命，但绝非
不存在，处置是**让它可见而非静默**：

- `discover()` 同时探针 `actual --version` 与 `<serverUrl>/info` 的
  `build.version`，`versionStatusOf` 按 `major.minor` 判定
  `ok` / `mismatch` / `unknown`；
- 主插件据此告警或（`cliVersionPolicy: 'strict'`）硬失败；
- 因为目录每次现场派生，CLI 换代只会换目录，**不会产出过时或错位的工具**。

## 契约

- 依赖：仅 `@modelcontextprotocol/server`（MCP 服务端 SDK）；`devDependencies`
  里的 `@modelcontextprotocol/client` 只供测试做进程内与 stdio 往返；
- 公开入口：`src/index.ts` 导出契约类型、help 解析、派生、argv 构造、CLI 解析
  与执行、发现编排、条目执行器、MCP 服务端工厂、Node 侧 I/O 装配；
- 模块划分：`contract.ts`（跨包类型）、`help.ts`（commander help 解析）、
  `derive.ts`（help 树 → 能力条目）、`argv.ts`（入参 → argv）、
  `classify.ts`（读/写判定与默认表）、`cli-run.ts`（解析与串行执行）、
  `discover.ts`（采集编排）、`invoke.ts`（条目执行器）、`server.ts`（MCP 服务端）、
  `node-io.ts`（真实 I/O）、`bin/mcp.ts`（stdio 入口）。

## 测试

`tests/{help,derive,argv,cli-run,discover,server,bin}.test.ts`：

- `help`/`derive`/`argv` 以**真实抓取的 help 原文**（`tests/fixtures/*.txt`）
  与合成 help 树双向钉住解析、并集、注记、枚举收敛与 argv 形态；
- `cli-run` 覆盖候选解析顺序、环境下发（密钥只进 env）、凭据解析钩子
  （每次调用重新解析、解析失败与当场密钥的脱敏）、串行化、退出码透出与超时；
- `discover` 串起「解析 → 采集 → 派生 → 调用」，断言 argv 真正到达 CLI；
- `server` 用 `InMemoryTransport` 起真实 MCP 会话，断言 `tools/list`、
  `tools/call`、错误结果与越界枚举的拒绝；
- `bin` 用 `StdioClientTransport` **拉起构建产物 `lib/bin/mcp.js`**，证明格式一
  对任意 MCP 宿主可用（替身 CLI，零网络零费用）。

`python3 scripts/dshctl.py test` 一键运行。
