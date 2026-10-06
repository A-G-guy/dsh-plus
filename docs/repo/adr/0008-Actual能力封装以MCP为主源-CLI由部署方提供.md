---
description: ADR 0008：Actual 能力封装以 MCP 为主源，DSH 工具由其 tools/list 派生
type: event
last_modified: "2026-10-07 00:39"
---

# ADR 0008：Actual 能力封装以 MCP 为主源，DSH 工具由其 tools/list 派生

- 状态：已采纳（2026-10-05）
- 背景：新增 Actual Budget 支持，要求把官方 `@actual-app/cli` 自动化封装为
  两种格式（MCP 服务 + DSH 工具），且二者都由 CLI 的 help 文本派生以避免
  过时错位；预设只使用第二种格式。需定**能力主源放在哪一侧**（CLI 二进制的
  提供方式另见 [adr/0011](0011-Actual-CLI不进依赖改运行时探测.md)）。

## 决策

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

## 后果

- 格式一（MCP 服务端）是格式二的唯一能力来源，日常每次发现都会走到，不是死代码；
- 独立 stdio 入口与进程内挂载共用同一份 `createActualMcpServer`，可移植性与实际
  运行路径同源；
- 会话建立失败时降级为 CLI help 树目录（`source: 'cli'`），可用性不因格式一层失效
  而受损。

## 后续约束

- 新增或改名 Actual 命令族的过滤、以及读/写判定的默认表，改在
  `actual-mcp/src/classify.ts`（未命中一律落「问」侧）；
- 提示词引用的族名 × 动作由 `packages/actual/tests/prompt.test.ts` 按 help
  fixture 钉住；CLI 换代时若动作增删，该测试会先红，提示词随之更新；
- 格式一的 stdio 入口不写任何非协议内容到 stdout（MCP 会话通道）。
