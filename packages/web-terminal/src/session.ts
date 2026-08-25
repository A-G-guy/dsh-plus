/**
 * 单个持久会话：node-pty 句柄 + scrollback 环形缓冲 + 事件扇出。
 * 生命周期独立于连接——attach/detach 只增减 sink 计数，不触碰 PTY；
 * kill（或 shell 自行退出）才真正回收。空闲跟踪（最近输入/输出时刻）
 * 供 registry 空闲清扫判定。
 * @module web-terminal/session
 */
import { randomBytes } from 'node:crypto'
import { clampCols, clampRows, type SessionDto } from './protocol.ts'
import { Scrollback, type SessionSink } from './scrollback.ts'

export interface TerminalSessionOptions {
  id?: string
  name: string
  cwd: string
  cols: number
  rows: number
  scrollbackLines: number
  scrollbackMaxBytes: number
  createdAtMs?: number
}

/** 会话退出事件：registry 转发为 exit 广播并清理登记。 */
export type SessionExitListener = (event: {
  exitCode: number | null
  signal: string | null
}) => void

export class TerminalSession {
  readonly id: string
  readonly createdAtMs: number
  readonly cwd: string

  private pty: import('./pty.ts').PtyLike | null
  private readonly scrollback: Scrollback
  private readonly sinks = new Set<SessionSink>()
  private readonly exitListeners = new Set<SessionExitListener>()
  private name: string
  private lastActivityAtMs: number
  private exited = false
  private exitFacts: { exitCode: number | null; signal: string | null } | null = null

  constructor(pty: import('./pty.ts').PtyLike, options: TerminalSessionOptions) {
    this.pty = pty
    this.id = options.id ?? `t-${randomBytes(6).toString('hex')}`
    this.name = options.name
    this.cwd = options.cwd
    this.createdAtMs = options.createdAtMs ?? Date.now()
    this.lastActivityAtMs = this.createdAtMs
    this.scrollback = new Scrollback({
      maxLines: options.scrollbackLines,
      maxBytes: options.scrollbackMaxBytes,
    })
    pty.onData((data) => this.handleOutput(data))
    pty.onExit(({ exitCode, signal }) => this.handleExit(exitCode, signal))
  }

  /** 显示名（registry 校验后写入）。 */
  displayName(): string {
    return this.name
  }

  rename(name: string): void {
    this.name = name
  }

  pid(): number | null {
    return this.pty?.pid ?? null
  }

  running(): boolean {
    return !this.exited
  }

  /** 空闲清扫依据：最近一次输入或输出时刻。 */
  idleSince(): number {
    return this.lastActivityAtMs
  }

  attachedCount(): number {
    return this.sinks.size
  }

  /** 挂载一个 sink；返回 detach 函数。附带当前 scrollback replay 供回放。 */
  attach(sink: SessionSink): { detach: () => void; replay: string } {
    this.sinks.add(sink)
    let detached = false
    return {
      detach: () => {
        if (detached) return
        detached = true
        this.sinks.delete(sink)
      },
      replay: this.scrollback.replay(),
    }
  }

  /** 终端输入（尺寸已在边界钳制；长度由调用方校验）。 */
  input(data: string): void {
    if (this.exited || this.pty === null) return
    this.lastActivityAtMs = Date.now()
    this.pty.write(data)
  }

  /** 调整 PTY 尺寸（钳制后透传；last-writer-wins，多端冲突同 tmux 语义）。 */
  resize(cols: number, rows: number): void {
    if (this.exited || this.pty === null) return
    this.pty.resize(clampCols(cols), clampRows(rows))
  }

  /** 注册一次性退出监听（session 内部去重由 registry 保证只触发一次）。 */
  onExit(listener: SessionExitListener): void {
    if (this.exited) {
      listener(this.exitFacts ?? { exitCode: null, signal: null })
      return
    }
    this.exitListeners.add(listener)
  }

  /** 主动关闭：TERM → 宽限 → KILL 由 registry 编排，这里只透传 TERM。 */
  terminate(signal?: string): void {
    this.pty?.kill(signal)
  }

  /** 供测试注入输出（不经过 PTY）。 */
  handleOutput(data: string): void {
    if (this.exited) return
    this.lastActivityAtMs = Date.now()
    this.scrollback.append(data)
    for (const sink of [...this.sinks]) sink.output(data)
  }

  /** 供测试/PTY 回调注入退出。 */
  handleExit(exitCode: number, signal: number | undefined): void {
    if (this.exited) return
    this.exited = true
    this.exitFacts = {
      exitCode: signal === undefined ? exitCode : null,
      signal: signalName(signal),
    }
    this.pty = null
    const facts = this.exitFacts
    for (const listener of [...this.exitListeners]) listener(facts)
    this.exitListeners.clear()
    for (const sink of [...this.sinks]) sink.exit(facts.exitCode, facts.signal)
    this.sinks.clear()
  }

  /** 对外 DTO（不可变快照）。 */
  dto(): SessionDto {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      pid: this.pid(),
      running: this.running(),
      exitCode: this.exitFacts?.exitCode ?? null,
      signal: this.exitFacts?.signal ?? null,
      createdAtMs: this.createdAtMs,
      lastActivityMs: this.lastActivityAtMs,
      attachedCount: this.sinks.size,
    }
  }
}

function signalName(signal: number | undefined): string | null {
  if (signal === undefined) return null
  const named: Record<number, string> = {
    1: 'SIGHUP',
    2: 'SIGINT',
    3: 'SIGQUIT',
    9: 'SIGKILL',
    13: 'SIGPIPE',
    15: 'SIGTERM',
    19: 'SIGSTOP',
    20: 'SIGTSTP',
    21: 'SIGTTIN',
    22: 'SIGTTOU',
  }
  return named[signal] ?? `SIG${signal}`
}
