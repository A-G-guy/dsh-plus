---
description: "ADR 0009：pre-commit「暂存包逐包 tsc」退役，类型闸门只留在测试链路"
type: event
last_modified: "2026-10-07 00:39"
---

# ADR 0009：pre-commit「暂存包逐包 tsc」退役，类型闸门只留在测试链路

- 状态：已采纳（2026-10-02）
- 背景：为压缩提交等待时间，曾在 pre-commit 对**暂存包**额外跑一次逐包
  `tsc --noEmit`（应急旁路 `DSHCTL_SKIP_TYPECHECK=1`）。门禁统一到 projects-go 后，
  其 pre-commit 只跑固定检查集、不支持外挂脚本链。

## 决策

放弃 pre-commit 类型检查，统一由 projects-go 承载提交门禁：

1. 移除 pre-commit 的暂存包 `tsc` 步骤与 `DSHCTL_SKIP_TYPECHECK=1` 旁路；
   裸 `git commit` 不再即时跑类型检查。
2. [adr/0002](0002-类型检查纳入守门.md) 决定 1–3 的守门链路不变
   （`dshctl test` / `dshctl finish` / `release publish`，以及根脚本
   `pnpm test` / `pnpm typecheck`），仍是全量类型检查的强制点。

## 后果

- 提交前必须自行跑 `pnpm test`：类型错误可能在 `git commit` 时无感、直到守门链路才红；
- 提交等待时间不再含类型检查（当时的动机），代价是本地漏跑即失去即时反馈。
