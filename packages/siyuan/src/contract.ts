/**
 * 主/子插件共享的能力清单契约（纯类型 + 少量纯常量）。
 *
 * 子插件（@dsh-plus/siyuan-tools）按本契约把能力包装成 DSH 工具，
 * 主插件（@dsh-plus/siyuan）的运行时负责产出与刷新清单；两侧只经
 * 本文件对齐，避免跨包运行时依赖。
 * @module @dsh-plus/siyuan/contract
 */

/** 能力条目的来源：MCP tools/list 或 kernel CLI help 树。 */
export type CapabilitySource = 'mcp' | 'cli'

/** MCP action → cobra 子命令名（自动同名/kebab 化之后仍不一致的显式差异表）。 */
export type CliActionMap = Record<string, string>

/**
 * 一条能力的 CLI 兜底执行计划（纯数据，可序列化）。
 *
 * - `kind: 'subcommands'`：`kernel <family> <action> …`，`actionMap` 为
 *   MCP action → cobra 子命令（缺席表示该能力不可 CLI 映射）；
 * - `kind: 'direct'`：`kernel <family> …`（cobra 无子命令），此时
 *   MCP 侧 action 枚举必须 ≤1 个值，多余 action 无法表达。
 */
export interface CliPlan {
  family: string
  kind: 'subcommands' | 'direct'
  actionMap?: CliActionMap
  /** MCP 属性名 → 位置参数名（如 sql 的 `stmt` → `<statement>`）。 */
  positionalByProp?: Record<string, string>
}

/** 一个可包装为 DSH 工具的能力。 */
export interface CapabilityEntry {
  /** 模型可见工具名（默认取 MCP/CLI 原名，可经 namePrefix 加前缀）。 */
  name: string
  description: string
  inputSchema: Record<string, unknown>
  source: CapabilitySource
  /** MCP 公告的结构化输出 Schema（SiYuan 3.8.6 未公告，保留透传位）。 */
  outputSchema?: unknown
  /** 上游要求任务执行扩展（MCP 侧透传给官方适配器）。 */
  taskRequired?: boolean
  /** CLI 兜底执行计划；MCP 能力经交叉映射后附带，CLI 原生能力恒存在。 */
  cli?: CliPlan
}

/** 健康（MCP）与 CLI help 树的交叉校验结果。 */
export interface CapabilityDrift {
  /** MCP 有、CLI 无（如 web_fetch/http_request 等插件侧能力）。 */
  mcpOnly: string[]
  /** CLI 有、MCP 无（如 serve/help/completion 已排除后的剩余差异）。 */
  cliOnly: string[]
  /** MCP 有、但无法映射到 CLI 兜底执行的能力。 */
  unmapped: string[]
}

/** 一次能力发现的完整产物。 */
export interface SiyuanManifest {
  /** `mixed` = MCP 主源且完成 CLI 交叉校验；`mcp`/`cli` = 单源降级。 */
  source: 'mcp' | 'cli' | 'mixed'
  version: string
  entries: CapabilityEntry[]
  drift: CapabilityDrift
}

/** 连接解析结果：HTTP 执行面 + CLI 兜底执行面。 */
export interface SiyuanConnection {
  mode: 'docker' | 'native' | 'http'
  /** MCP 端点（如 http://127.0.0.1:6806/mcp）。 */
  endpoint: string
  /** API token；仅用于 MCP 鉴权头，禁止进入日志/提示词/工具输出。 */
  token: string
  /** CLI 前缀（如 `docker exec <container> /opt/siyuan/kernel`）；空 = 无 CLI。 */
  cli: string[]
  /** CLI 使用的工作区路径（容器内/本机路径）。 */
  workspace: string
  container?: string
}

/** 服务状态快照（进运行时上下文与日志，不含 token）。 */
export interface SiyuanStatus {
  mode: 'docker' | 'native' | 'http'
  endpoint: string
  version: string
  mcpConnected: boolean
  cliAvailable: boolean
  /** 最近一次发现/连接错误（已脱敏的 message）。 */
  lastError?: string
}
