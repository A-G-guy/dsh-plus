/**
 * MCP 服务端（格式一）：把能力目录 1:1 暴露为 MCP 工具。
 *
 * 同一份 `createActualMcpServer` 同时支撑两条使用路径——独立 stdio 进程
 * （任意 MCP 宿主）与主插件进程内挂载（DSH 工具由 tools/list 派生），
 * 因此格式一不是死代码，而是格式二的**唯一能力来源**。
 * @module @dsh-plus/actual-mcp/server
 */

import { fromJsonSchema, type JsonSchemaType, McpServer } from '@modelcontextprotocol/server'

import type { CapabilityEntry } from './contract.ts'
import type { EntryInvoker, InvokeOptions } from './invoke.ts'

/** 服务端装配面。 */
export interface ActualMcpHost {
  /** 本次服务端实例的能力目录（换代 = 重建实例）。 */
  entries: readonly CapabilityEntry[]
  invoke: EntryInvoker
  /** 单次工具调用超时（毫秒）。 */
  timeoutMs: number
  serverInfo?: { name: string; version: string }
}

/** 默认服务端标识。 */
const DEFAULT_SERVER_INFO = { name: 'dsh-plus-actual', version: '0.1.0' }

/** CLI 输出 → 模型可见文本（字符串原样，其余 pretty JSON）。 */
export function formatToolValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

/** 提取错误文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 安全注解：只读工具显式声明，写工具按保守语义标为可能具破坏性。 */
function annotationsOf(entry: CapabilityEntry): Record<string, boolean> {
  return entry.readOnly === true
    ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    : { readOnlyHint: false, destructiveHint: true }
}

/** 注册一条能力；工具调用失败按 MCP 错误结果返回（模型能读到 CLI 原文）。 */
function registerEntry(server: McpServer, host: ActualMcpHost, entry: CapabilityEntry): void {
  server.registerTool(
    entry.name,
    {
      description: entry.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(
        entry.inputSchema as unknown as JsonSchemaType,
      ),
      annotations: annotationsOf(entry),
    },
    async (args) => {
      const options: InvokeOptions = { timeoutMs: host.timeoutMs }
      try {
        const value = await host.invoke(entry, args as Record<string, unknown>, options)
        return { content: [{ type: 'text' as const, text: formatToolValue(value) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: messageOf(error) }] }
      }
    },
  )
}

/**
 * 由能力目录装配 MCP 服务端。
 * @param host - 目录、执行器与超时。
 * @returns 未连接的 {@link McpServer} 实例；连接方式（stdio / 进程内）由调用方决定。
 */
export function createActualMcpServer(host: ActualMcpHost): McpServer {
  const server = new McpServer(host.serverInfo ?? DEFAULT_SERVER_INFO, {
    capabilities: { tools: {} },
  })
  for (const entry of host.entries) registerEntry(server, host, entry)
  return server
}
