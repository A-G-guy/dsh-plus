/**
 * 进程内 MCP 会话：把 `@dsh-plus/actual-mcp` 的 MCP 服务端用 InMemoryTransport
 * 接到官方客户端上——**格式二（DSH 工具）由格式一（MCP tools/list）引出**，
 * 与思源「MCP 为主源、CLI 为兜底」同构，且不额外起进程。
 *
 * 工具调用的返回值经「JSON → 文本 → JSON」往返，与直连 CLI 路径形状一致；
 * 服务端已把工具失败表示为 `isError` 结果，这里转成异常上抛，绝不触发兜底重放
 * （写操作重放会造成重复记账）。
 * @module @dsh-plus/actual/mcp-session
 */

import {
  type CapabilityEntry,
  createActualMcpServer,
  type EntryInvoker,
  parseJsonOrText,
} from '@dsh-plus/actual-mcp'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

/** 运行时消费的 MCP 会话窄面（测试可整体替身）。 */
export interface McpSessionLike {
  readonly connected: boolean
  /** 建立连接；超时/失败抛错（实例即弃，重建即可）。 */
  connect(timeoutMs: number): Promise<void>
  /** `tools/list` → 能力条目（`source` 由调用方补齐）。 */
  listTools(): Promise<Pick<CapabilityEntry, 'name' | 'description' | 'inputSchema'>[]>
  callTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<unknown>
  close(): Promise<void>
}

/** 从 MCP 结果里取第一段文本（非文本块忽略）。 */
function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    const item = block as { type?: unknown; text?: unknown }
    if (item.type === 'text' && typeof item.text === 'string') return item.text
  }
  return ''
}

/** 进程内 MCP 会话：一个实例 = 一代能力目录。 */
class InProcessSession implements McpSessionLike {
  private readonly entries: readonly CapabilityEntry[]
  private readonly invoke: EntryInvoker
  private readonly timeoutMs: number
  private server: ReturnType<typeof createActualMcpServer> | undefined
  private client: Client | undefined
  private isOpen = false

  constructor(entries: readonly CapabilityEntry[], invoke: EntryInvoker, timeoutMs: number) {
    this.entries = entries
    this.invoke = invoke
    this.timeoutMs = timeoutMs
  }

  get connected(): boolean {
    return this.isOpen
  }

  async connect(timeoutMs: number): Promise<void> {
    const server = createActualMcpServer({
      entries: this.entries,
      invoke: this.invoke,
      timeoutMs: this.timeoutMs,
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client(
      { name: 'dsh-plus-actual', version: '0.1.0' },
      { capabilities: {}, versionNegotiation: { mode: 'auto' } },
    )
    client.onclose = () => {
      this.isOpen = false
    }
    try {
      await withTimeout(
        Promise.all([server.connect(serverTransport), client.connect(clientTransport)]),
        timeoutMs,
        'Actual MCP connect',
      )
    } catch (error) {
      await client.close().catch(() => undefined)
      await server.close().catch(() => undefined)
      throw error
    }
    this.server = server
    this.client = client
    this.isOpen = true
  }

  async listTools(): Promise<Pick<CapabilityEntry, 'name' | 'description' | 'inputSchema'>[]> {
    const client = this.require()
    const { tools } = await client.listTools()
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }))
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<unknown> {
    const client = this.require()
    const requestOptions: Parameters<Client['callTool']>[1] = { timeout: options.timeoutMs }
    if (options.signal !== undefined) requestOptions.signal = options.signal
    const tool = this.entries.find((entry) => entry.name === name)
    if (tool !== undefined) {
      requestOptions.toolDefinition = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as never,
      }
    }
    const result = await client.callTool({ name, arguments: args }, requestOptions)
    const text = textOf(result)
    if ((result as { isError?: unknown }).isError === true) throw new Error(text)
    return parseJsonOrText(text)
  }

  async close(): Promise<void> {
    this.isOpen = false
    const client = this.client
    const server = this.server
    this.client = undefined
    this.server = undefined
    await client?.close().catch(() => undefined)
    await server?.close().catch(() => undefined)
  }

  /** 未连接即调用属于编程错误，给出带上下文的失败而非空引用。 */
  private require(): Client {
    if (this.client === undefined || !this.isOpen) throw new Error('Actual MCP 未连接')
    return this.client
  }
}

/** 超时竞速：到期以 Error 拒绝。 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 建立进程内 MCP 会话工厂。
 * @param entries - 由 CLI help 树派生的能力目录（MCP 服务端的注册来源）。
 * @param invoke - 条目执行器（MCP 服务端 handler 的实际执行面）。
 * @param timeoutMs - 单次工具调用超时。
 */
export function createInProcessSession(
  entries: readonly CapabilityEntry[],
  invoke: EntryInvoker,
  timeoutMs: number,
): McpSessionLike {
  return new InProcessSession(entries, invoke, timeoutMs)
}
