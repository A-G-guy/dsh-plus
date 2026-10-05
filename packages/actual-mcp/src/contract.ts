/**
 * Actual 能力清单契约（纯类型 + 少量纯常量）。
 *
 * 主插件（@dsh-plus/actual）与子插件（@dsh-plus/actual-tools）只经本文件对齐，
 * 避免跨包运行时依赖；本包同时是**可移植的 MCP 服务**（格式一）的实现载体，
 * 不依赖任何 DSH 平台包。
 * @module @dsh-plus/actual-mcp/contract
 */

import type { ReportsPlan } from '@dsh-plus/actual-reports'

/** 能力条目的来源：MCP tools/list 或 CLI help 树降级派生。 */
export type CapabilitySource = 'mcp' | 'cli'

/**
 * 一条能力的 CLI 执行计划（纯数据，可序列化）。
 *
 * - `kind: 'subcommands'`：`actual <family> <action> …`，`actionMap` 为
 *   action → 子命令名（本 CLI 恒为同名，保留映射位以备差异）；
 * - `kind: 'direct'`：`actual <family> …`（无子命令，如 `sync`）。
 */
export interface CliPlan {
  family: string
  kind: 'subcommands' | 'direct'
  actionMap?: Record<string, string>
  /** 模型属性名 → 位置参数名（如 `id` → `<id>`）。 */
  positionalByProp?: Record<string, string>
}

/**
 * 一个可包装为 DSH 工具 / MCP 工具的能力。
 *
 * 两类条目并存：
 * - 官方 CLI 派生（`cli` 计划）——格式一/格式二的能力来源；
 * - 伴侣 CLI 扩展（`reports` 计划）——官方 API 未提供的能力（自定义报表/仪表盘），
 *   由 `@dsh-plus/actual-reports` 声明，源码同源故不落 help 树。
 */
export interface CapabilityEntry {
  /** 工具名（默认取 CLI 命令族名，可经 namePrefix 加前缀）。 */
  name: string
  description: string
  inputSchema: Record<string, unknown>
  source: CapabilitySource
  /**
   * 整工具只读（全部 action 都在只读集合内）——保守判定，只用于 MCP
   * `readOnlyHint` 注解；逐调用的写确认判定走 `classifyAction`。
   */
  readOnly?: boolean
  /** CLI 执行计划（MCP 条目在派生时一并附带，供进程内执行与降级兜底）。 */
  cli?: CliPlan
  /** 伴侣 CLI 执行计划（报表/仪表盘族）；与 `cli` 互斥。 */
  reports?: ReportsPlan
}

/** MCP tools/list 与 CLI help 树的交叉校验结果。 */
export interface CapabilityDrift {
  /** MCP 有、CLI help 树无。 */
  mcpOnly: string[]
  /** CLI help 树有、MCP 无。 */
  cliOnly: string[]
  /** 有工具但无法映射到 CLI 执行计划的能力。 */
  unmapped: string[]
}

/** 一次能力发现的完整产物。 */
export interface ActualManifest {
  /** `mixed` = 进程内 MCP 主源 + CLI help 树交叉校验；`mcp`/`cli` = 单源。 */
  source: 'mcp' | 'cli' | 'mixed'
  /** CLI 版本（`actual --version`）。 */
  cliVersion: string
  /** 服务端版本（`<serverUrl>/info` 的 build.version；探测失败为空串）。 */
  serverVersion: string
  entries: CapabilityEntry[]
  drift: CapabilityDrift
}

/** 解析后的 CLI 执行面（含密钥，禁止进日志/提示词/工具输出）。 */
export interface ActualCliBinding {
  /** CLI argv 前缀（如 `['actual']` 或 `['node','/path/dist/cli.js']`）。 */
  argv: string[]
  /** CLI 自报版本。 */
  version: string
  /** 该 CLI 的来源描述（诊断用，不含密钥）。 */
  origin: string
  /** 子进程环境变量（密钥经此下发，绝不出现在 argv）。 */
  env: Record<string, string>
}

/** 连接与发现状态快照（不含密钥）。 */
export interface ActualStatus {
  /** CLI argv 前缀的人类可读形式。 */
  cli: string
  cliVersion: string
  cliAvailable: boolean
  serverUrl: string
  serverVersion: string
  mcpConnected: boolean
  /** 版本策略判定结果：`ok` / `mismatch` / `unknown`。 */
  versionStatus: 'ok' | 'mismatch' | 'unknown'
  /** 最近一次发现/连接错误（已脱敏）。 */
  lastError?: string
}
