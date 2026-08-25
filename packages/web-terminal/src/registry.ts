/**
 * 终端会话注册表服务（ctx.webTerminal）：会话创建/列举/杀/改名、
 * attach/input/resize 的权威入口、空闲清扫定时器、disposal 全杀。
 *
 * 编排要点：
 * - 空闲清扫：仅当「零挂载 且 距最近输入/输出超过 idleTimeoutMs」才杀；
 *   挂后台跑构建的会话因持续输出而保留（零输出零输入才算空闲）。
 * - 会话退出（自然退出或 kill）：从登记表移除、广播 exit、终结 kill 阶梯。
 * - kill 阶梯：TERM → killGraceMs → KILL；会话退出事件落地即完成。
 * - disposal：全部会话走同一阶梯并 await；另挂 process 'exit' 同步 KILL
 *   兜底（对齐官方 dsh-subprocess-local 的宿主退出语义）。
 * @module web-terminal/registry
 */
import { homedir } from 'node:os'
import { basename } from 'node:path'

import { type Context, Service } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

import { Config, SETTINGS_NS, type WebTerminalConfig } from './config.ts'
import { NAME_MAX_CHARS, type SessionDto } from './protocol.ts'
import { type PtyFactory, spawnNodePty } from './pty.ts'
import type { SessionSink } from './scrollback.ts'
import { TerminalSession } from './session.ts'

/** 空闲清扫扫描间隔（固定；idleTimeoutMs 才是用户可调项）。 */
const SWEEP_INTERVAL_MS = 30_000

export class WebTerminalService extends Service {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly ptyFactory: PtyFactory
  private current: () => WebTerminalConfig
  private disposed = false

  constructor(ctx: Context, config: WebTerminalConfig, ptyFactory: PtyFactory = spawnNodePty) {
    super(ctx, 'webTerminal')
    this.ptyFactory = ptyFactory
    this.current = () => config
    installSettingsSection(ctx, SETTINGS_NS, Config, config, {
      setSource: (source) => {
        this.current = source
      },
      onChange: () => {},
    })
    this.armSweeper()
    ctx.effect(() => () => this.disposeAll(), 'web-terminal: sessions teardown')
    // 宿主同步退出兜底：无法 await 的路径上直接 KILL 全部 PTY。
    const onHostExit = () => {
      for (const session of this.sessions.values()) session.terminate('SIGKILL')
    }
    process.once('exit', onHostExit)
    ctx.effect(
      () => () => {
        process.off('exit', onHostExit)
      },
      'web-terminal: host-exit hook',
    )
  }

  /** 当前生效配置（诊断用）。 */
  config(): WebTerminalConfig {
    return this.current()
  }

  list(): SessionDto[] {
    return [...this.sessions.values()].map((session) => session.dto())
  }

  /** 创建新会话（超限抛错；名字边界校验后回退 shell 基名）。 */
  create(request: { name?: string; cwd?: string }): SessionDto {
    const config = this.current()
    if (this.sessions.size >= config.maxSessions) {
      throw new TerminalRegistryError(
        `session limit reached (${config.maxSessions})`,
        'too-many-sessions',
      )
    }
    const argv = resolveShellArgv(config)
    const cwd = resolveCwd(request.cwd ?? config.cwd)
    const name = sanitizeName(request.name) ?? basename(argv[0] ?? 'shell')
    const pty = this.ptyFactory({
      argv,
      cwd,
      env: shellEnvironment(config),
      cols: config.initialCols,
      rows: config.initialRows,
    })
    const session = new TerminalSession(pty, {
      name,
      cwd,
      cols: config.initialCols,
      rows: config.initialRows,
      scrollbackLines: config.scrollbackLines,
      scrollbackMaxBytes: config.scrollbackMaxKb * 1024,
    })
    this.sessions.set(session.id, session)
    session.onExit(() => {
      this.sessions.delete(session.id)
    })
    return session.dto()
  }

  /** 权限已由 API 层校验；此处只做存在性。 */
  get(id: string): TerminalSession {
    const session = this.sessions.get(id)
    if (session === undefined)
      throw new TerminalRegistryError(`unknown session ${id}`, 'no-session')
    return session
  }

  async kill(id: string): Promise<boolean> {
    const session = this.sessions.get(id)
    if (session === undefined) return false
    await this.shutdown(session, 'killed by client')
    return true
  }

  rename(id: string, name: string): SessionDto {
    const session = this.get(id)
    const cleaned = sanitizeName(name)
    if (cleaned === undefined) {
      throw new TerminalRegistryError(
        'session name must be 1-64 printable characters',
        'name-invalid',
      )
    }
    session.rename(cleaned)
    return session.dto()
  }

  /** attach 的权威入口（WS 层调用）：登记 sink + 返回 replay。 */
  attach(
    id: string,
    sink: SessionSink,
  ): { session: TerminalSession; detach: () => void; replay: string } {
    const session = this.get(id)
    const { detach, replay } = session.attach(sink)
    return { session, detach, replay }
  }

  /** 空闲清扫判定（暴露为方法便于单测）：零挂载且超时才可清。 */
  isIdleExpired(session: TerminalSession, now: number): boolean {
    const timeout = this.current().idleTimeoutMs
    if (timeout <= 0) return false
    return session.attachedCount() === 0 && now - session.idleSince() >= timeout
  }

  /** 触发一次清扫（定时器与测试共用）。 */
  async sweep(now = Date.now()): Promise<number> {
    const victims: TerminalSession[] = []
    for (const session of this.sessions.values()) {
      if (this.isIdleExpired(session, now)) victims.push(session)
    }
    for (const session of victims) await this.shutdown(session, 'idle timeout')
    return victims.length
  }

  /** kill 阶梯：TERM → 宽限 → KILL；以会话退出事件收尾。 */
  private async shutdown(session: TerminalSession, reason: string): Promise<void> {
    if (!session.running()) {
      this.sessions.delete(session.id)
      return
    }
    const grace = this.current().killGraceMs
    const exited = new Promise<void>((resolve) => {
      session.onExit(() => resolve())
      // TERM 后 grace 毫秒仍未退 → KILL；再兜底 resolve 防 KILL 后事件丢失。
      const timer = setTimeout(() => {
        session.terminate('SIGKILL')
        setTimeout(resolve, Math.min(grace, 500))
      }, grace)
      timer.unref?.()
    })
    session.terminate('SIGTERM')
    await exited
    this.sessions.delete(session.id)
    this.ctx.logger('web-terminal').info(`session ${session.id} closed (${reason})`)
  }

  private armSweeper(): void {
    const timer = setInterval(() => {
      if (this.disposed) return
      void this.sweep().catch(() => {})
    }, SWEEP_INTERVAL_MS)
    timer.unref?.()
    this.ctx.effect(
      () => () => {
        clearInterval(timer)
      },
      'web-terminal: sweeper timer',
    )
  }

  private async disposeAll(): Promise<void> {
    this.disposed = true
    const closing = [...this.sessions.values()].map((session) =>
      this.shutdown(session, 'service disposal').catch(() => {}),
    )
    await Promise.all(closing)
  }
}

/** registry 层业务错误（API 层映射为 HTTP 状态码）。 */
export type RegistryErrorCode =
  | 'too-many-sessions'
  | 'no-session'
  | 'name-invalid'
  | 'input-too-large'
  | 'invalid-size'

export class TerminalRegistryError extends Error {
  readonly code: RegistryErrorCode

  constructor(message: string, code: RegistryErrorCode) {
    super(message)
    this.code = code
  }
}

/** shell argv：配置路径（默认 $SHELL / /bin/bash）+ 附加参数。 */
export function resolveShellArgv(config: WebTerminalConfig): string[] {
  const shell =
    config.shellPath.trim().length > 0
      ? config.shellPath.trim()
      : (process.env.SHELL ?? '/bin/bash').trim()
  return [shell, ...config.shellArgs]
}

/** 初始 cwd：配置或请求的绝对路径，空/相对回退家目录。 */
export function resolveCwd(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || !trimmed.startsWith('/')) return homedir()
  return trimmed
}

/** 显示名清洗：去首尾空白、限长、拒绝控制字符；非法/缺省返回 undefined。 */
export function sanitizeName(raw: string | null | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined
  const trimmed = raw.trim().slice(0, NAME_MAX_CHARS)
  if (trimmed.length === 0) return undefined
  // 可打印字符 + 常见空白；拒绝控制字节（C0 控制符与 DEL）。
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 显式匹配控制字符即本函数的目的
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return undefined
  return trimmed
}

/** 会话环境：官方凭据清洗为底 → TERM / COLORTERM → 用户配置覆盖。 */
export function shellEnvironment(config: WebTerminalConfig): Record<string, string> {
  return {
    ...scrubbedParentEnv(),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...config.env,
  }
}
