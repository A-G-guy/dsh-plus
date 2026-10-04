---
description: ADR 0008：Actual 能力封装以 MCP 为主源、工具由其派生，CLI 由部署方提供而非打进依赖
type: event
last_modified: "2026-10-05 04:17"
---

# ADR 0008：Actual 能力封装以 MCP 为主源，CLI 由部署方提供而不进依赖

- 状态：已采纳（2026-10-05）
- 背景：新增 Actual Budget 支持，要求把官方 `@actual-app/cli` 自动化封装为
  两种格式（MCP 服务 + DSH 工具），且二者都由 CLI 的 help 文本派生以避免
  过时错位；预设只使用第二种格式。需要定两件事：**能力主源放在哪一侧**，
  以及 **CLI 二进制由谁提供**。

## 决策一：MCP 为主源，DSH 工具由其 `tools/list` 派生

沿用思源已落地的同构做法（`siyuan` + `siyuan-tools`）：能力目录不由 DSH 侧
直接产出，而是先构建 MCP 服务端（`@dsh-plus/actual-mcp`），再由主插件在
**进程内**用 `InMemoryTransport` 挂载并 `tools/list`，DSH 工具从该结果派生。

- 格式一因此**不是死代码**：它是格式二的唯一能力来源，日常每次发现都会走到；
- 独立 stdio 入口（`lib/bin/mcp.js`）与进程内挂载共用同一个
  `createActualMcpServer`，可移植性主张与实际运行路径是同一份实现；
- DSH 工具经官方 `createMcpToolDefinition` 适配，canonical 输出、镜像投影与
  `isError` 语义沿用官方实现；
- 会话建立失败时降级为 CLI help 树目录（`source: 'cli'`），注册裸
  `ToolDefinition`，执行面不变——可用性不因格式一层失效而受损。

被否方案：DSH 侧直接从 help 树产出工具（少一层）。它会让可移植件退化为
无人验证的旁路，重演「两份实现各自漂移」的老问题。

## 决策二：`@actual-app/cli` 不进依赖，改为运行时探测

`@dsh-plus/actual-mcp` **不声明** `@actual-app/cli` 为 `dependencies`，也不声明
为 optional peer——实测两者都会把它装进来。

实测数据（2026-10-05，pnpm 12.3.4）：

| 事项 | 结果 |
|---|---|
| 安装闭包 | 225MB / 59 包（absurd-sql 46M、@actual-app 41M、@jlongster 28M、date-fns 28M、better-sqlite3 27M、es-toolkit 18M、hyperformula 14M） |
| `peerDependenciesMeta.optional: true` | pnpm 仍自动安装，`+80` 包 |
| 构建脚本 | `better-sqlite3@13.0.3` 触发 `ERR_PNPM_IGNORED_BUILDS`，**`pnpm install` 直接失败** |
| PATH 上的 CLI | 本机未安装（`actual` / `actual-cli` 均无） |

因此解析顺序为：`cliCommand` 配置 → `ACTUAL_CLI` 环境变量（二者显式，失败即
报错、不回退）→ PATH `actual` → PATH `actual-cli` → 包内可解析的
`@actual-app/cli`（若部署方自行装入）→ 报错并给出官方安装指引。

代价：多一步官方文档里的部署动作。收益：profile 不承担 225MB 与一个原生模块，
且 `pnpm install` 不会因未授权的构建脚本而硬失败。若日后确需零配置，
把该包从「可解析」提升为直接依赖即可，本决策需一并复核。

## 新增的依赖边

biome 分层矩阵新增两条（原「唯一例外 `siyuan-tools → siyuan`」扩为多例外）：

| 边 | 理由 |
|---|---|
| `actual → actual-mcp` | 主插件消费可移植封装层的公开契约与 MCP 服务端工厂 |
| `actual-tools → actual` | 子插件消费主插件的公开契约与读/写判定默认值 |

`actual-mcp` 零 `@dsh-plus/*` 依赖，故不需例外。三条边均在 `biome.json`
的 `noRestrictedImports` 白名单中显式登记，并由
[仓库管理规范](../仓库管理规范.md) 的分层矩阵同步。

## 后续约束

- 新增或改名 Actual 命令族的过滤、以及读/写判定的默认表，改在
  `actual-mcp/src/classify.ts`（未命中一律落「问」侧）；
- 提示词引用的族名 × 动作由 `packages/actual/tests/prompt.test.ts` 按 help
  fixture 钉住；CLI 换代时若动作增删，该测试会先红，提示词随之更新；
- 格式一的 stdio 入口不写任何非协议内容到 stdout（MCP 会话通道）。
