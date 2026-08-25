/**
 * WebSocket 连接管理：单连接多路复用、自动重连（指数退避）、
 * 重连后对全部已知会话重发 attach（服务端 replay 恢复视图）。
 *
 * React 组件经 useSyncExternalStore 订阅 store 快照；一切协议交互
 * 收敛在本模块，组件只渲染。
 * @module web-terminal/panel/connection
 */
import type { ClientMessage, ServerMessage, SessionDto } from '../protocol.ts'

export type ConnectionState = 'connecting' | 'open' | 'closed' | 'disabled'

export interface ConnectionSnapshot {
  state: ConnectionState
  sessions: SessionDto[]
  maxSessions: number
  error: string | null
  /** 单调递增：output/exit 事件驱动 xterm 写入时避免快照膨胀。 */
  revision: number
}

type Listener = () => void

export class TerminalConnection {
  private ws: WebSocket | null = null
  private state: ConnectionState = 'connecting'
  private sessionsById = new Map<string, SessionDto>()
  private maxSessions = 8
  private error: string | null = null
  private revision = 0
  private listeners = new Set<Listener>()
  private attached = new Set<string>()
  private outputHandlers = new Map<string, (data: string) => void>()
  private exitHandlers = new Map<string, (code: number | null, signal: string | null) => void>()
  private replayHandlers = new Map<string, (replay: string) => void>()
  private retries = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  start(): void {
    // dispose 后允许重新 start（面板重开 / React StrictMode 双挂载）。
    this.disposed = false
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws !== null) return
    this.state = 'connecting'
    this.publish()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/dsh-plus/web-terminal/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.retries = 0
      this.state = 'open'
      this.error = null
      this.publish()
      // 重连恢复：对全部已知（未退出）会话重挂载，replay 回填视图。
      for (const id of this.attached) this.send({ kind: 'attach', sessionId: id })
    }
    ws.onmessage = (event) => this.handleMessage(event.data)
    ws.onclose = () => {
      this.ws = null
      this.state = 'closed'
      this.publish()
      this.scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }

  /** 订阅 store 变化（useSyncExternalStore）。 */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 缓存快照：useSyncExternalStore 要求 getSnapshot 引用稳定，变更经 publish 重建。 */
  private cachedSnapshot: ConnectionSnapshot = {
    state: 'connecting',
    sessions: [],
    maxSessions: 8,
    error: null,
    revision: 0,
  }

  getSnapshot = (): ConnectionSnapshot => this.cachedSnapshot

  /** attach + 注册该会话的 output/exit/replay 处理器。 */
  attach(
    sessionId: string,
    handlers: {
      onOutput: (data: string) => void
      onExit: (code: number | null, signal: string | null) => void
      onReplay: (replay: string) => void
    },
  ): () => void {
    this.outputHandlers.set(sessionId, handlers.onOutput)
    this.exitHandlers.set(sessionId, handlers.onExit)
    this.replayHandlers.set(sessionId, handlers.onReplay)
    this.attached.add(sessionId)
    this.send({ kind: 'attach', sessionId })
    return () => {
      this.outputHandlers.delete(sessionId)
      this.exitHandlers.delete(sessionId)
      this.replayHandlers.delete(sessionId)
      if (this.attached.delete(sessionId)) this.send({ kind: 'detach', sessionId })
    }
  }

  input(sessionId: string, data: string): void {
    this.send({ kind: 'input', sessionId, data })
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.send({ kind: 'resize', sessionId, cols, rows })
  }

  async createSession(name?: string, cwd?: string): Promise<SessionDto> {
    const response = await fetch('/dsh-plus/web-terminal/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cwd }),
    })
    const body = (await response.json()) as { session?: SessionDto; error?: string }
    if (!response.ok || body.session === undefined) {
      throw new Error(body.error ?? `create failed (${response.status})`)
    }
    this.sessionsById.set(body.session.id, body.session)
    this.revision += 1
    this.publish()
    return body.session
  }

  async killSession(sessionId: string): Promise<void> {
    await fetch('/dsh-plus/web-terminal/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    const response = await fetch('/dsh-plus/web-terminal/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, name }),
    })
    if (!response.ok) return
    const body = (await response.json()) as { session?: SessionDto }
    if (body.session !== undefined) {
      this.sessionsById.set(body.session.id, body.session)
      this.publish()
    }
  }

  private handleMessage(raw: unknown): void {
    let message: ServerMessage
    try {
      message = JSON.parse(String(raw)) as ServerMessage
    } catch {
      return
    }
    switch (message.kind) {
      case 'sessions': {
        this.maxSessions = message.maxSessions
        this.sessionsById = new Map(message.sessions.map((session) => [session.id, session]))
        this.publish()
        return
      }
      case 'attached': {
        this.sessionsById.set(message.session.id, message.session)
        this.replayHandlers.get(message.session.id)?.(message.replay)
        this.publish()
        return
      }
      case 'output': {
        this.outputHandlers.get(message.sessionId)?.(message.data)
        return
      }
      case 'exit': {
        const existing = this.sessionsById.get(message.sessionId)
        if (existing !== undefined) {
          this.sessionsById.set(message.sessionId, {
            ...existing,
            running: false,
            exitCode: message.exitCode,
            signal: message.signal,
          })
        }
        this.attached.delete(message.sessionId)
        this.exitHandlers.get(message.sessionId)?.(message.exitCode, message.signal)
        this.revision += 1
        this.publish()
        return
      }
      case 'detached': {
        this.attached.delete(message.sessionId)
        return
      }
      case 'error': {
        if (message.code === 'disabled') this.state = 'disabled'
        this.error = message.message
        this.publish()
        return
      }
      default:
        return
    }
  }

  private send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return
    const delay = Math.min(10_000, 500 * 2 ** this.retries)
    this.retries += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.start()
    }, delay)
  }

  private publish(): void {
    this.cachedSnapshot = {
      state: this.state,
      sessions: [...this.sessionsById.values()],
      maxSessions: this.maxSessions,
      error: this.error,
      revision: this.revision,
    }
    for (const listener of [...this.listeners]) listener()
  }
}
