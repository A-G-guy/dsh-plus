---
description: "ADR 0011：@actual-app/cli 不进依赖，改运行时探测（profile 不承担 225MB 与原生构建）"
type: event
last_modified: "2026-10-07 00:39"
---

# ADR 0011：`@actual-app/cli` 不进依赖，改运行时探测

- 状态：已采纳（2026-10-05）
- 背景：Actual Budget 的能力来源经 CLI 的 help 文本派生（封装方式见
  [adr/0008](0008-Actual能力封装以MCP为主源-CLI由部署方提供.md)）；需定 **CLI 二进制
  由谁提供**——打进插件依赖，还是由部署方提供、插件运行时探测。

## 决策

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

## 新增的依赖边

biome 分层矩阵新增两条（原「唯一例外 `siyuan-tools → siyuan`」扩为多例外）：

| 边 | 理由 |
|---|---|
| `actual → actual-mcp` | 主插件消费可移植封装层的公开契约与 MCP 服务端工厂 |
| `actual-tools → actual` | 子插件消费主插件的公开契约与读/写判定默认值 |

`actual-mcp` 零 `@dsh-plus/*` 依赖，故不需例外。三条边均在 `biome.json`
的 `noRestrictedImports` 白名单中显式登记，并由
[仓库管理规范](../仓库管理规范.md) 的分层矩阵同步。

## 后果

- profile 不承担 225MB 与一个原生模块，`pnpm install` 不会因未授权的构建脚本而硬失败；
- 代价：多一步官方文档里的部署动作（`npm i -g @actual-app/cli` 或经 `cliCommand` 指定）；
- 若日后确需零配置，把该包从「可解析」提升为直接依赖即可，本决策需一并复核。
