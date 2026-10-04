/**
 * Actual 能力运行时：连接缓存、进程内 MCP 会话生命周期、双源发现（MCP
 * tools/list 主源 × CLI help 树交叉校验与兜底）、统一 invoke 与变更订阅。
 * cordis 无关的纯逻辑核心，I/O 全部经注入依赖，可整体替身测试。
 * @module @dsh-plus/actual/runtime
 */

import {
  ActualCli,
  type ActualCliBinding,
  type ActualManifest,
  type ActualStatus,
  type CapabilityEntry,
  type CliConfig,
  type CliDeps,
  callToolResultOf,
  computeDrift,
  createEntryInvoker,
  discover,
  type EntryInvoker,
  sanitize,
  versionStatusOf,
} from '@dsh-plus/actual-mcp'

import type { McpSessionLike } from './mcp-session.ts'
import { ReconnectScheduler } from './reconnect.ts'

/** 日志窄面（cordis logger 天然满足）。 */
export interface RuntimeLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** 运行时配置 = CLI 连接 + 暴露过滤 + 版本策略。 */
export interface RuntimeConfig {
  cli: CliConfig
  allow: string[]
  deny: string[]
  cliVersionPolicy: 'warn' | 'strict'
  toolCallTimeoutMs: number
}

/** 注入依赖 = CLI I/O + 进程内 MCP 会话工厂。 */
export interface RuntimeDeps extends CliDeps {
  createSession(entries: readonly CapabilityEntry[], invoke: EntryInvoker): McpSessionLike
}

/** 一次工具调用的执行选项。 */
export interface InvokeOptions {
  signal?: AbortSignal
  timeoutMs: number
}

/** MCP 连接建立的超时预算。 */
const MCP_CONNECT_TIMEOUT_MS = 5_000

/** 能力运行时：一个实例对应主插件一行的生命周期。 */
export class ActualRuntime {
  private binding: ActualCliBinding | undefined
  private session: McpSessionLike | undefined
  private cliInvoker: EntryInvoker | undefined
  private manifestCache: ActualManifest | undefined
  private discovering: Promise<ActualManifest> | undefined
  private readonly listeners = new Set<(manifest: ActualManifest) => void>()
  private readonly reconnect: ReconnectScheduler
  private disposed = false
  private lastError: string | undefined
  private cliVersion = ''
  private serverVersion = ''
  private version: 'ok' | 'mismatch' | 'unknown' = 'unknown'

  private readonly config: RuntimeConfig
  private readonly deps: RuntimeDeps
  private readonly logger: RuntimeLogger

  constructor(config: RuntimeConfig, deps: RuntimeDeps, logger: RuntimeLogger) {
    this.config = config
    this.deps = deps
    this.logger = logger
    this.reconnect = new ReconnectScheduler({
      onAttempt: () => {
        if (this.disposed) return
        void this.discover().catch((error: unknown) =>
          this.logger.warn(`Actual 重连发现失败：${messageOf(error)}`),
        )
      },
      onGiveUp: (failures) =>
        this.logger.error(
          `Actual 重连连续失败 ${failures} 次，停止自动重试（恢复后 /reload 可触发）`,
        ),
    })
  }

  /** 连接与发现状态快照（不含密钥）。 */
  status(): ActualStatus {
    const status: ActualStatus = {
      cli: this.binding?.origin ?? '未解析',
      cliVersion: this.cliVersion,
      cliAvailable: this.binding !== undefined,
      serverUrl: this.config.cli.serverUrl,
      serverVersion: this.serverVersion,
      mcpConnected: this.session?.connected === true,
      versionStatus: this.version,
    }
    if (this.lastError !== undefined) status.lastError = this.lastError
    return status
  }

  /** 最近一次成功发现的清单。 */
  manifest(): ActualManifest | undefined {
    return this.manifestCache
  }

  /** 订阅清单变更（新清单产出时触发），返回退订。 */
  onChange(cb: (manifest: ActualManifest) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** 单飞发现：并发调用共享同一次执行。 */
  discover(): Promise<ActualManifest> {
    if (this.discovering === undefined) {
      const task = this.runDiscover()
        .catch((error: unknown) => {
          this.lastError = this.sanitize(error instanceof Error ? error.message : String(error))
          this.reconnect.schedule()
          throw error
        })
        .finally(() => {
          this.discovering = undefined
        })
      this.discovering = task
    }
    return this.discovering
  }

  /**
   * 执行一次能力调用：**MCP 优先，CLI 兜底**。
   *
   * 返回值形状由 `entry.source` 决定（它同时决定子插件用哪个注册器）：
   * `'mcp'` → canonical MCP 结果信封（官方 `createMcpToolDefinition` 要求）；
   * `'cli'` → CLI 原始值（裸 ToolDefinition 自行渲染）。兜底路径也必须守这条
   * 契约——否则会话掉线后同一个工具会因形状不同而失败。
   *
   * 兜底只在 MCP 会话本身不可用时触发——工具失败已由服务端表示为错误结果并
   * 转成异常，绝不重放（写操作重放会造成重复记账）。
   */
  async invoke(
    entry: CapabilityEntry,
    args: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<unknown> {
    if (this.session?.connected === true) {
      return await this.session.callTool(entry.name, args, options)
    }
    if (entry.cli !== undefined && this.cliInvoker !== undefined) {
      this.logger.warn(`Actual MCP 会话不可用，降级为 CLI 直连执行：${entry.name}`)
      const value = await this.cliInvoker(entry, args, options)
      return entry.source === 'mcp' ? callToolResultOf(value) : value
    }
    throw new Error(
      `Actual MCP 不可达且该能力无 CLI 回退：${entry.name}（${this.lastError ?? '未连接'}）`,
    )
  }

  /** 释放会话、重连调度与订阅。 */
  dispose(): void {
    this.disposed = true
    this.reconnect.stop()
    this.listeners.clear()
    const session = this.session
    this.session = undefined
    if (session !== undefined) void session.close().catch(() => undefined)
  }

  /** 一次完整发现：CLI help 树 → MCP 服务端 → tools/list → 交叉校验 → 过滤 → 发布。 */
  private async runDiscover(): Promise<ActualManifest> {
    const found = await discover(this.config.cli, this.deps, {})
    this.binding = found.binding
    this.cliVersion = found.binding.version
    this.serverVersion = found.serverVersion
    for (const warning of found.warnings) this.logger.warn(`Actual 能力派生告警：${warning}`)
    this.assertVersionPolicy()

    const cli = new ActualCli(found.binding, this.config.cli, this.deps)
    const invoker = createEntryInvoker(cli, this.deps, found.tree)
    this.cliInvoker = invoker
    const { entries, drift, source } = await this.entriesFrom(found, invoker)
    const manifest: ActualManifest = {
      source,
      cliVersion: this.cliVersion,
      serverVersion: this.serverVersion,
      entries: this.filter(entries),
      drift,
    }
    this.publish(manifest)
    return manifest
  }

  /**
   * 能力目录：MCP tools/list 为主源，会话建不起来时降级为 CLI help 树目录。
   *
   * 降级只是**目录来源**的变化，执行面仍是同一条 CLI 链路，因此可用性不受影响；
   * 目录里始终附带 `cli` 执行计划，兜底与策略层都靠它。
   */
  private async entriesFrom(
    found: Awaited<ReturnType<typeof discover>>,
    invoker: EntryInvoker,
  ): Promise<{
    entries: CapabilityEntry[]
    drift: ActualManifest['drift']
    source: ActualManifest['source']
  }> {
    try {
      await this.replaceSession(found.entries, invoker)
      const tools = await this.requireSession().listTools()
      const { entries, unmapped } = mapTools(tools, found.entries)
      const drift = computeDrift(entries, found.tree.families, unmapped)
      if (drift.cliOnly.length > 0 || drift.unmapped.length > 0) {
        this.logger.info(
          `Actual 能力交叉校验：MCP-only=${drift.mcpOnly.join(',') || '-'} ` +
            `CLI-only=${drift.cliOnly.join(',') || '-'} 无 CLI 回退=${drift.unmapped.join(',') || '-'}`,
        )
      }
      return { entries, drift, source: 'mixed' }
    } catch (error) {
      this.logger.warn(`Actual MCP 会话不可用，降级为 CLI help 树目录：${messageOf(error)}`)
      await this.closeSession()
      return {
        entries: found.entries,
        drift: computeDrift([], found.tree.families, []),
        source: 'cli',
      }
    }
  }

  /** 关闭当前会话（降级与换代都先关旧）。 */
  private async closeSession(): Promise<void> {
    const stale = this.session
    this.session = undefined
    if (stale !== undefined) await stale.close().catch(() => undefined)
  }

  /** 版本策略：mismatch 时告警或（strict）硬失败，绝不静默带过。 */
  private assertVersionPolicy(): void {
    this.version = versionStatusOf(this.cliVersion, this.serverVersion)
    if (this.version !== 'mismatch') return
    const detail = `Actual CLI ${this.cliVersion} 与服务端 ${this.serverVersion} 的 major.minor 不一致`
    if (this.config.cliVersionPolicy === 'strict') {
      throw new Error(
        `${detail}（cliVersionPolicy=strict）。请对齐两侧版本，` +
          '或用 cliCommand 指定匹配的 CLI，或把 cliVersionPolicy 改为 warn。',
      )
    }
    this.logger.warn(
      `${detail}。Actual 服务端只做 CRDT 同步中继、预算逻辑全在客户端，通常仍可工作；` +
        '若需硬失败请设 cliVersionPolicy=strict。',
    )
  }

  /** 换代 MCP 会话（旧会话先关，避免同代工具目录残留）。 */
  private async replaceSession(
    entries: readonly CapabilityEntry[],
    invoke: EntryInvoker,
  ): Promise<void> {
    await this.closeSession()
    const session = this.deps.createSession(entries, invoke)
    await session.connect(MCP_CONNECT_TIMEOUT_MS)
    this.session = session
  }

  /** 已连接的会话；未连接属于编程错误。 */
  private requireSession(): McpSessionLike {
    if (this.session === undefined) throw new Error('Actual MCP 会话未建立')
    return this.session
  }

  /** 暴露过滤：allow 白名单（空=全量）后剔除 deny。 */
  private filter(entries: CapabilityEntry[]): CapabilityEntry[] {
    return entries.filter(
      (entry) =>
        (this.config.allow.length === 0 || this.config.allow.includes(entry.name)) &&
        !this.config.deny.includes(entry.name),
    )
  }

  /** 发布新清单（签名不变则跳过），成功发现即重置重连预算。 */
  private publish(manifest: ActualManifest): void {
    const signature = JSON.stringify(manifest)
    if (this.manifestCache !== undefined && JSON.stringify(this.manifestCache) === signature) return
    this.manifestCache = manifest
    this.reconnect.reset()
    this.lastError = undefined
    for (const cb of this.listeners) {
      try {
        cb(manifest)
      } catch (error) {
        this.logger.warn(`Actual 清单订阅者异常：${messageOf(error)}`)
      }
    }
  }

  /** 脱敏：错误文本中出现的密钥一律替换为 ***。 */
  private sanitize(message: string): string {
    return sanitize(message, this.config.cli)
  }
}

/**
 * MCP `tools/list` → 能力条目：按裸族名回填 `cli` 执行计划与只读注解，
 * 回填不到计划的记入 `unmapped`（交叉校验会报告）。
 */
function mapTools(
  tools: readonly Pick<CapabilityEntry, 'name' | 'description' | 'inputSchema'>[],
  derivedEntries: readonly CapabilityEntry[],
): { entries: CapabilityEntry[]; unmapped: string[] } {
  const derived = new Map(derivedEntries.map((entry) => [entry.name, entry]))
  const unmapped: string[] = []
  const entries: CapabilityEntry[] = tools.map((tool) => {
    const source = derived.get(tool.name)
    const entry: CapabilityEntry = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      source: 'mcp',
    }
    if (source?.cli !== undefined) entry.cli = source.cli
    else unmapped.push(tool.name)
    if (source?.readOnly === true) entry.readOnly = true
    return entry
  })
  return { entries, unmapped }
}

/** 提取错误文本（异常或任意值）。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
