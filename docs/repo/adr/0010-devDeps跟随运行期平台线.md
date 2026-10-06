---
description: "ADR 0010：devDependencies 必须跟随运行期平台线（平台包 devDeps 与宿主同版）"
type: event
last_modified: "2026-10-07 00:39"
---

# ADR 0010：devDependencies 必须跟随运行期平台线

- 状态：已采纳（2026-10-04）
- 背景：llm-pi 需求核对时发现**全仓 devDependencies 停在 `0.2.0-rc.1`**，而宿主已升到
  `0.2.1-alpha.1`：11 个包逐包 `tsc --noEmit` 报
  `Property 'webServer'/'credentials' does not exist on type 'Context'`。
  平台包的类型增强（`Context` 的服务声明）与代码目标线错位，与当次功能改动无关，
  已用独立 worktree 在 HEAD 复现确认。

## 决策

1. **平台包 devDependencies 与运行期宿主同版**：`@deepseek-ai/*` 一律等于本机 dsh 安装线，
   基座包（cordis / schemastery）同步对齐；peer 范围只表达兼容区间
   （见[仓库管理规范](../仓库管理规范.md)的「版本策略」）。
2. **平台换线 = 全仓一次性换线**：`dshctl platform-sync <版本>` + 基座包手工对齐，
   不留任何包停在旧线（示例：本次 24/24 包类型检查与公共契约**零代码改动**转绿）。

## 后果

- 构建/类型/单测面对的就是运行期那份套件；平台类型增强缺失这类"跨线错位"在守门期即暴露；
- 部分包单独升线会制造"本包绿、他包红"的假象，因此换线必须整仓执行；
- peer 范围与 devDeps 精确版双写的形态不变（外部化行为见
  [adr/0001](0001-平台依赖必须-peer.md)）。
