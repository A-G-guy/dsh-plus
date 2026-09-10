/**
 * 宿主/浏览器两半共享的线协议：路由前缀、REST DTO、WS 消息。
 * 客户端不拼路径、不猜字段名，两端仅通过本模块对齐。
 * @module @dsh-plus/web-terminal/protocol
 */

/** REST 路由前缀（webServer prefix 注册）。 */
export const ROUTE_PREFIX = '/dsh-plus/web-terminal'
/** WebSocket 升级路由（exact）。 */
export const WS_PATH = `${ROUTE_PREFIX}/ws`

/** 单条 input 上限（UTF-8 字节）：粘贴大块的硬护栏，正常输入远小于此。 */
export const INPUT_MAX_BYTES = 256 * 1024
/** 输出背压阈值：socket 缓冲超过即丢弃该连接的 output 帧并告警。 */
export const BACKPRESSURE_LIMIT_BYTES = 2 * 1024 * 1024
/** 终端尺寸钳制范围（与主流终端一致）。 */
export const MIN_COLS = 2
export const MAX_COLS = 500
export const MIN_ROWS = 2
export const MAX_ROWS = 500
/** 会话名长度上限。 */
export const NAME_MAX_CHARS = 64

export function clampCols(value: number): number {
  return Math.min(MAX_COLS, Math.max(MIN_COLS, Math.floor(value)))
}

export function clampRows(value: number): number {
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor(value)))
}

// ── REST DTO ────────────────────────────────────────────────────────────────

export interface SessionDto {
  /** 稳定会话 id（服务端铸造，URL 安全）。 */
  id: string
  /** 可编辑显示名（缺省 = shell 基名）。 */
  name: string
  /** 孵化时的工作目录（展示用；shell 内 cd 后不追踪）。 */
  cwd: string
  /** 顶层进程 pid（存活期有效）。 */
  pid: number | null
  /** 存活 / 已退出。 */
  running: boolean
  /** 退出码与信号（退出后有效）。 */
  exitCode: number | null
  signal: string | null
  /** 创建时间（ms epoch）。 */
  createdAtMs: number
  /** 最近一次输入或输出时间（ms epoch，空闲清理依据）。 */
  lastActivityMs: number
  /** 当前挂载（attach）的连接数。 */
  attachedCount: number
}

export interface CreateRequest {
  /** 可选显示名。 */
  name?: string
  /** 可选初始工作目录（缺省用配置 cwd）。 */
  cwd?: string
}

export interface CreateResponse {
  session: SessionDto
}

export interface ListResponse {
  sessions: SessionDto[]
  /** 配置的并发上限（前端禁用新建按钮用）。 */
  maxSessions: number
}

export interface KillRequest {
  sessionId: string
}

export interface RenameRequest {
  sessionId: string
  name: string
}

export interface RenameResponse {
  session: SessionDto
}

export type TerminalErrorCode =
  | 'disabled'
  | 'too-many-sessions'
  | 'no-session'
  | 'name-invalid'
  | 'spawn-failed'
  | 'input-too-large'
  | 'invalid-size'
  | 'access-denied'
  | 'internal'

export interface ApiErrorBody {
  error: string
  code?: TerminalErrorCode
}

// ── WebSocket 消息（JSON 文本帧）────────────────────────────────────────────

export type ClientMessage =
  | { kind: 'attach'; sessionId: string }
  | { kind: 'detach'; sessionId: string }
  | { kind: 'input'; sessionId: string; data: string }
  | { kind: 'resize'; sessionId: string; cols: number; rows: number }

export type ServerMessage =
  | { kind: 'attached'; session: SessionDto; replay: string }
  | { kind: 'detached'; sessionId: string }
  | { kind: 'output'; sessionId: string; data: string }
  | { kind: 'exit'; sessionId: string; exitCode: number | null; signal: string | null }
  | { kind: 'sessions'; sessions: SessionDto[]; maxSessions: number }
  | { kind: 'error'; message: string; code?: TerminalErrorCode }

/**
 * 服务端帧运行期守卫：帧来自 WebSocket，畸形帧若仅靠断言带入 switch，
 * 缺 sessions 数组会在 `.map()` 处抛未捕获异常而整面板失效。
 * 只校验分发与解引用所依赖的最少字段，语义合法性仍由消费端负责。
 */
export function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as { kind?: unknown; sessions?: unknown; session?: unknown }
  switch (frame.kind) {
    case 'attached':
      return typeof frame.session === 'object' && frame.session !== null
    case 'sessions':
      return Array.isArray(frame.sessions)
    case 'detached':
    case 'output':
    case 'exit':
    case 'error':
      return true
    default:
      return false
  }
}
