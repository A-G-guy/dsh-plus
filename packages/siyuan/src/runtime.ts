/**
 * SiYuan 能力运行时：连接缓存、MCP 会话生命周期、双源发现（MCP 主源 ×
 * CLI help 树交叉校验与降级）、统一 invoke（MCP 执行、CLI 兜底）与
 * 变更订阅。cordis 无关的纯逻辑核心，I/O 全部经注入依赖，可整体替身测试。
 * @module @dsh-plus/siyuan/runtime
 */

import { collectActionHelps, collectFamilyHelps, collectInvokeHelp, execKernel } from './cli.ts'
import { buildArgv, buildCliEntry, buildCliPlan, computeDrift } from './cli-map.ts'
import { type ConnectionConfig, type ConnectionDeps, resolveConnection } from './connection.ts'
import type { CapabilityEntry, SiyuanConnection, SiyuanManifest, SiyuanStatus } from './contract.ts'
import type { KernelHelp } from './help.ts'
import type { McpLike, McpToolInfo } from './mcp.ts'

/** 日志窄面（cordis logger 天然满足）。 */
export interface RuntimeLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** 运行时配置 = 连接配置 + 暴露过滤。 */
export interface RuntimeConfig extends ConnectionConfig {
  allow: string[]
  deny: string[]
}

/** 注入依赖 = 连接 I/O + MCP 会话工厂。 */
export interface RuntimeDeps extends ConnectionDeps {
  createMcp(endpoint: string, token: string): McpLike
}

/** 一次工具调用的执行选项。 */
export interface InvokeOptions {
  signal?: AbortSignal
  timeoutMs: number
}

const MCP_CONNECT_TIMEOUT_MS = 4_000
const HEALTHY_BUDGET_MS = 12_000
const DEGRADED_BUDGET_MS = 20_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const VERSION_PROBE_TIMEOUT_MS = 2_000

/** 能力运行时：一个实例对应主插件一行的生命周期。 */
export class SiyuanRuntime {
  private connection: SiyuanConnection | undefined
  private mcp: McpLike | undefined
  private manifestCache: SiyuanManifest | undefined
  private familyHelps = new Map<string, KernelHelp>()
  private actionHelps = new Map<string, KernelHelp>()
  private discovering: Promise<SiyuanManifest> | undefined
  private readonly listeners = new Set<(manifest: SiyuanManifest) => void>()
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectAttempts = 0
  private gaveUp = false
  private disposed = false
  private lastError: string | undefined
  private version = ''

  private readonly config: RuntimeConfig
  private readonly deps: RuntimeDeps
  private readonly logger: RuntimeLogger

  constructor(config: RuntimeConfig, deps: RuntimeDeps, logger: RuntimeLogger) {
    this.config = config
    this.deps = deps
    this.logger = logger
  }

  /** 连接与发现状态快照（不含 token）。 */
  status(): SiyuanStatus {
    const status: SiyuanStatus = {
      mode: this.connection?.mode ?? (this.config.mode === 'docker' ? 'docker' : 'http'),
      endpoint: this.config.endpoint,
      version: this.version,
      mcpConnected: this.mcp?.connected === true,
      cliAvailable: (this.connection?.cli.length ?? 0) > 0,
    }
    if (this.lastError !== undefined) status.lastError = this.lastError
    return status
  }

  /** 最近一次成功发现的清单。 */
  manifest(): SiyuanManifest | undefined {
    return this.manifestCache
  }

  /** 订阅清单变更（新清单产出时触发），返回退订。 */
  onChange(cb: (manifest: SiyuanManifest) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** 单飞发现：并发调用共享同一次执行。 */
  discover(): Promise<SiyuanManifest> {
    if (this.discovering === undefined) {
      const task = this.runDiscover()
        .catch((error: unknown) => {
          this.lastError = this.sanitize(error instanceof Error ? error.message : String(error))
          this.scheduleReconnect()
          throw error
        })
        .finally(() => {
          this.discovering = undefined
        })
      this.discovering = task
    }
    return this.discovering
  }

  /** MCP 优先执行；连接不可用且有 CLI 计划时降级为 CLI。 */
  async invoke(
    entry: CapabilityEntry,
    args: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<unknown> {
    if (entry.source === 'mcp' && this.mcp?.connected === true) {
      try {
        return await this.mcp.callTool(entry.name, args, options)
      } catch (error) {
        if (options.signal?.aborted === true) throw error
        const alive = await this.probeEndpoint()
        if (alive) throw error
        this.logger.warn(
          `SiYuan MCP 调用失败且端点失联，尝试 CLI 兜底：${this.sanitize(String(error))}`,
        )
        this.markDisconnected()
      }
    }
    const conn = await this.currentConnection()
    if (entry.cli === undefined) {
      throw new Error(
        `SiYuan MCP 不可达且该能力无 CLI 兜底：${entry.name}（${this.lastError ?? '未连接'}）`,
      )
    }
    if (conn.cli.length === 0) throw new Error('SiYuan CLI 未配置，无法兜底执行')
    return await this.invokeCli(conn, entry.cli, args, options)
  }

  /** 释放会话、定时器与订阅。 */
  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.listeners.clear()
    const mcp = this.mcp
    this.mcp = undefined
    if (mcp !== undefined) void mcp.close().catch(() => undefined)
  }

  /** 一次完整发现：解析连接 → MCP 主源（失败则 CLI 降级）→ 过滤 → 发布。 */
  private async runDiscover(): Promise<SiyuanManifest> {
    const conn = await resolveConnection(this.config, this.deps)
    this.connection = conn
    this.familyHelps = new Map()
    this.actionHelps = new Map()
    this.version = await this.probeVersion()
    const manifest =
      (await this.discoverViaMcp(conn)) ?? (await this.discoverViaCli(conn)) ?? this.failDiscover()
    this.publish(manifest)
    return manifest
  }

  /** MCP 主源：tools/list + CLI help 交叉校验；失败返回 undefined 走降级。 */
  private async discoverViaMcp(conn: SiyuanConnection): Promise<SiyuanManifest | undefined> {
    let tools: McpToolInfo[] | undefined
    try {
      tools = await this.ensureMcp(conn)
    } catch (error) {
      this.lastError = this.sanitize(error instanceof Error ? error.message : String(error))
      this.logger.warn(`SiYuan MCP 不可达（${conn.endpoint}/mcp）：${this.lastError}`)
      this.scheduleReconnect()
    }
    if (tools === undefined) return undefined

    const helps = await collectFamilyHelps(this.deps, conn, Date.now() + HEALTHY_BUDGET_MS)
    this.familyHelps = helps
    const entries: CapabilityEntry[] = []
    const unmapped: string[] = []
    const mcpNames = new Set<string>()
    for (const tool of tools) {
      mcpNames.add(tool.name)
      const entry: CapabilityEntry = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        source: 'mcp',
      }
      if (tool.outputSchema !== undefined) entry.outputSchema = tool.outputSchema
      if (tool.taskRequired === true) entry.taskRequired = true
      const familyHelp = helps.get(tool.name)
      if (familyHelp !== undefined) {
        const plan = buildCliPlan(entry, familyHelp)
        if (plan === undefined) unmapped.push(tool.name)
        else entry.cli = plan
      }
      entries.push(entry)
    }
    for (const [family, help] of helps) {
      if (!mcpNames.has(family)) entries.push(buildCliEntry(family, help))
    }
    const drift = computeDrift(
      entries.filter((entry) => entry.source === 'mcp'),
      helps,
      unmapped,
    )
    if (drift.mcpOnly.length > 0 || drift.cliOnly.length > 0) {
      this.logger.info(
        `SiYuan 能力交叉校验：MCP-only=${drift.mcpOnly.join(',') || '-'} CLI-only=${drift.cliOnly.join(',') || '-'} 无兜底=${drift.unmapped.join(',') || '-'}`,
      )
    }
    return {
      source: helps.size > 0 ? 'mixed' : 'mcp',
      version: this.version,
      entries: this.filter(entries),
      drift,
    }
  }

  /** CLI 降级源：help 树（含 action 级）派生 CLI 原生能力。 */
  private async discoverViaCli(conn: SiyuanConnection): Promise<SiyuanManifest | undefined> {
    if (conn.cli.length === 0) return undefined
    this.logger.warn('SiYuan MCP 不可达，降级为 CLI 发现与执行（与运行中的服务并发写存在风险）')
    const deadline = Date.now() + DEGRADED_BUDGET_MS
    const families = await collectFamilyHelps(this.deps, conn, deadline)
    const actionHelps = await collectActionHelps(this.deps, conn, families, deadline)
    this.familyHelps = families
    this.actionHelps = actionHelps
    const entries = [...families].map(([family, help]) => buildCliEntry(family, help, actionHelps))
    if (entries.length === 0) return undefined
    return {
      source: 'cli',
      version: this.version,
      entries: this.filter(entries),
      drift: computeDrift([], families, []),
    }
  }

  /** 双源均不可用：抛出带上下文的失败（子插件仅告警，不影响激活）。 */
  private failDiscover(): never {
    throw new Error(`SiYuan 不可达：${this.lastError ?? 'MCP 与 CLI 均不可用'}`)
  }

  /** 建立（或复用）MCP 会话并拉取 tools/list；连接后列表失败按致命上抛。 */
  private async ensureMcp(conn: SiyuanConnection): Promise<McpToolInfo[]> {
    if (this.mcp?.connected !== true) {
      const stale = this.mcp
      this.mcp = undefined
      if (stale !== undefined) void stale.close().catch(() => undefined)
      const mcp = this.deps.createMcp(conn.endpoint, conn.token)
      mcp.onClose(() => this.markDisconnected())
      mcp.onChange(() => {
        this.logger.info('SiYuan 工具清单变更（list_changed），重新发现')
        void this.discover().catch((error: unknown) =>
          this.logger.warn(`重新发现失败：${messageOf(error)}`),
        )
      })
      await mcp.connect(MCP_CONNECT_TIMEOUT_MS)
      this.mcp = mcp
    }
    return await this.mcp.listTools()
  }

  /** 连接断开：标记失联并安排重连（disposed 时静默）。 */
  private markDisconnected(): void {
    if (this.disposed) return
    this.scheduleReconnect()
  }

  /** 指数退避重连发现；连续失败超过上限后放弃一次告警，等待外部触发。 */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== undefined) return
    if (this.reconnectAttempts >= 10) {
      if (!this.gaveUp) {
        this.gaveUp = true
        this.logger.error(
          'SiYuan 重连连续失败 10 次，停止自动重试（恢复后 /reload 或重装插件可触发）',
        )
      }
      return
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS)
    this.reconnectAttempts += 1
    const timer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.disposed) return
      void this.discover().catch((error: unknown) =>
        this.logger.warn(`SiYuan 重连发现失败：${messageOf(error)}`),
      )
    }, delay)
    timer.unref?.()
    this.reconnectTimer = timer
  }

  /** 探测 HTTP 端点存活（版本端点，无鉴权）。 */
  private async probeEndpoint(): Promise<boolean> {
    const res = await this.deps
      .fetchJson(`${this.config.endpoint}/api/system/version`, {
        signal: AbortSignal.timeout(VERSION_PROBE_TIMEOUT_MS),
      })
      .catch(() => undefined)
    return res?.ok === true
  }

  /** 读取 SiYuan 版本号（失败返回空串）。 */
  private async probeVersion(): Promise<string> {
    const res = await this.deps
      .fetchJson(`${this.config.endpoint}/api/system/version`, {
        signal: AbortSignal.timeout(VERSION_PROBE_TIMEOUT_MS),
      })
      .catch(() => undefined)
    const data = (res?.body as { data?: unknown } | undefined)?.data
    return typeof data === 'string' ? data : ''
  }

  /** 暴露过滤：allow 白名单（空=全量）后剔除 deny。 */
  private filter(entries: CapabilityEntry[]): CapabilityEntry[] {
    return entries.filter(
      (entry) =>
        (this.config.allow.length === 0 || this.config.allow.includes(entry.name)) &&
        !this.config.deny.includes(entry.name),
    )
  }

  /** 发布新清单（签名不变则跳过），健康清单同时重置重连预算。 */
  private publish(manifest: SiyuanManifest): void {
    const signature = JSON.stringify(manifest)
    if (this.manifestCache !== undefined && JSON.stringify(this.manifestCache) === signature) return
    this.manifestCache = manifest
    if (manifest.source !== 'cli') {
      this.reconnectAttempts = 0
      this.lastError = undefined
    }
    for (const cb of this.listeners) {
      try {
        cb(manifest)
      } catch (error) {
        this.logger.warn(`SiYuan 清单订阅者异常：${messageOf(error)}`)
      }
    }
  }

  /** 当前连接（未解析则现场解析）。 */
  private async currentConnection(): Promise<SiyuanConnection> {
    if (this.connection === undefined)
      this.connection = await resolveConnection(this.config, this.deps)
    return this.connection
  }

  /** CLI 兜底执行：调用级 help（带缓存）→ argv → 全局项 → JSON 结果。 */
  private async invokeCli(
    conn: SiyuanConnection,
    plan: NonNullable<CapabilityEntry['cli']>,
    args: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<unknown> {
    const action =
      plan.kind === 'subcommands' && typeof args.action === 'string' ? args.action : undefined
    const cacheKey = `${plan.family} ${action ?? ''}`
    let invHelp = this.actionHelps.get(cacheKey)
    if (invHelp === undefined) {
      invHelp = await collectInvokeHelp(
        this.deps,
        conn,
        plan.family,
        action,
        this.familyHelps.get(plan.family),
      )
      this.actionHelps.set(cacheKey, invHelp)
    }
    const { argv, missingRequired } = buildArgv(args, plan, invHelp)
    if (missingRequired.length > 0) {
      throw new Error(
        `SiYuan CLI 缺少必填参数：${missingRequired.join(', ')}（${plan.family}${action ?? ''}）`,
      )
    }
    const globalArgs = ['-f', 'json', ...(conn.workspace !== '' ? ['-w', conn.workspace] : [])]
    const deadline = armDeadline(options)
    try {
      const result = await execKernel(this.deps, conn, [plan.family, ...argv, ...globalArgs], {
        signal: deadline.signal,
      })
      if (deadline.signal.aborted) throw new Error(`SiYuan CLI 执行超时（${options.timeoutMs}ms）`)
      if (options.signal?.aborted === true) throw new Error('SiYuan CLI 执行被中止')
      if (result.code !== 0) {
        const detail = (result.stderr || result.stdout).trim().slice(0, 2_000)
        throw new Error(`SiYuan CLI 执行失败（exit ${result.code}）：${detail}`)
      }
      return parseJsonOrText(result.stdout)
    } finally {
      deadline.done()
    }
  }

  /** 脱敏：错误文本中出现的 token 一律替换为 ***。 */
  private sanitize(message: string): string {
    const token = this.connection?.token ?? this.config.token
    return token !== '' ? message.split(token).join('***') : message
  }
}

/** 提取错误文本（异常或任意值）。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 合并调用方 signal 与超时预算的 AbortSignal。 */
function armDeadline(options: InvokeOptions): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs)
  timer.unref?.()
  const onAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    },
  }
}

/** `-f json` 成功输出按 JSON 解析；非 JSON 按原文返回。 */
function parseJsonOrText(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return stdout
  }
}
