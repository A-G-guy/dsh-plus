/**
 * 思源笔记 MCP 端点的薄会话封装（官方 `@modelcontextprotocol/client`）：
 * 一次 connect、tools/list、tools/call、listChanged 订阅与关闭。
 * 协议细节（现代/遗留协商、会话、_meta）全部交给官方 SDK。
 * @module @dsh-plus/siyuan/mcp
 */
import { Client, StreamableHTTPClientTransport, type Tool } from '@modelcontextprotocol/client'

/** `tools/list` 的一条工具（仅取包装所需字段）。 */
export interface McpToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: unknown
  taskRequired?: boolean
}

/** 运行时消费的 MCP 会话窄面（测试可整体替身）。 */
export interface McpLike {
  readonly connected: boolean
  /** 建立连接；超时/失败抛错（实例即弃，重建即可）。 */
  connect(timeoutMs: number): Promise<void>
  listTools(): Promise<McpToolInfo[]>
  callTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<unknown>
  /** 服务端 `notifications/tools/list_changed` 订阅，返回退订。 */
  onChange(cb: () => void): () => void
  /** 连接断开（onclose）订阅，返回退订。 */
  onClose(cb: () => void): () => void
  close(): Promise<void>
}

/** 超时竞速：到期以 Error 拒绝并中止底层连接。 */
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

/** 真实 MCP 会话：一个实例 = 一次连接生命周期（SDK 绑定 transport 为终生）。 */
export class SiyuanMcp implements McpLike {
  private readonly endpoint: string
  private readonly token: string
  private client: Client | undefined
  private tools = new Map<string, Tool>()
  private changeCbs = new Set<() => void>()
  private closeCbs = new Set<() => void>()
  private isOpen = false

  constructor(endpoint: string, token: string) {
    this.endpoint = endpoint
    this.token = token
  }

  get connected(): boolean {
    return this.isOpen
  }

  async connect(timeoutMs: number): Promise<void> {
    const client = new Client(
      { name: 'dsh-plus-siyuan', version: '0.1.0' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
        listChanged: {
          tools: {
            onChanged: () => {
              for (const cb of this.changeCbs) cb()
            },
          },
        },
      },
    )
    client.onclose = () => {
      const wasOpen = this.isOpen
      this.isOpen = false
      if (wasOpen) for (const cb of this.closeCbs) cb()
    }
    const transport = new StreamableHTTPClientTransport(new URL(`${this.endpoint}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    })
    try {
      await withTimeout(client.connect(transport), timeoutMs, 'SiYuan MCP connect')
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
    this.client = client
    this.isOpen = true
  }

  async listTools(): Promise<McpToolInfo[]> {
    const client = this.require()
    if (client.getServerCapabilities()?.tools === undefined) return []
    const result = await client.listTools(undefined, { cacheMode: 'refresh' })
    this.tools = new Map(result.tools.map((tool) => [tool.name, tool]))
    return result.tools.map((tool) => {
      const info: McpToolInfo = {
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }
      if (tool.outputSchema !== undefined) info.outputSchema = tool.outputSchema
      if (tool.execution?.taskSupport === 'required') info.taskRequired = true
      return info
    })
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<unknown> {
    const client = this.require()
    const request: Parameters<Client['callTool']>[0] = { name, arguments: args }
    const tool = this.tools.get(name)
    const requestOptions: Parameters<Client['callTool']>[1] = { timeout: options.timeoutMs }
    if (options.signal !== undefined) requestOptions.signal = options.signal
    if (tool !== undefined) requestOptions.toolDefinition = tool
    return await client.callTool(request, requestOptions)
  }

  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb)
    return () => this.changeCbs.delete(cb)
  }

  onClose(cb: () => void): () => void {
    this.closeCbs.add(cb)
    return () => this.closeCbs.delete(cb)
  }

  async close(): Promise<void> {
    this.isOpen = false
    const client = this.client
    this.client = undefined
    if (client !== undefined) await client.close().catch(() => undefined)
  }

  /** 未连接即调用属于编程错误，给出带上下文的失败而非空引用。 */
  private require(): Client {
    if (this.client === undefined || !this.isOpen) throw new Error('SiYuan MCP 未连接')
    return this.client
  }
}
