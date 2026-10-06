/**
 * 主插件服务（宿主 realm，键 `actual`）：把配置 + 真实 I/O 装配成
 * {@link ActualRuntime}，对子插件暴露发现/执行/状态/订阅的薄委托。
 *
 * 配置为 loader 解析的 volatile 活动字段：`current()` 现取即热（配置卡片写入
 * 用户层后无需 /reload）。**连接相关字段变化时重建运行时**——CLI 绑定、服务端
 * 地址、预算与超时都参与 CLI 进程的构造，只换值不重建会让新旧配置混用；重建
 * 后立即按新配置重新发现。纯展示/策略字段（name/description/order/persona 等）
 * 不触发重建，它们在下一次预设注册或工具注册时自然生效。
 *
 * 密钥解析每次操作即时进行：行级 Config 声明的优先，否则问官方 credentials
 * seam（`$DSH_HOME/.credentials.yaml`，浏览器半经官方 `remote.credentials`
 * 命名空间写入）——改口令后下一次工具调用即生效，无需 /reload 或重启。
 * 日志与状态均经脱敏。数据目录默认落在插件数据
 * 目录（与用户自有 CLI 的 `~/.actual-cli/data` 隔离，避免缓存与迁移互相踩）。
 * @module @dsh-plus/actual/service
 */
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import {
  type ActualManifest,
  type ActualStatus,
  type CapabilityEntry,
  type CliConfig,
  configSecretsOf,
  createNodeDeps,
} from '@dsh-plus/actual-mcp'
import { pluginDataPath, unwrapVolatile } from '@dsh-plus/shared'

import type { ActualConfig, ActualConfigFields } from './config.ts'
import { type CredentialsFace, resolveSecrets } from './credentials.ts'
import { createInProcessSession } from './mcp-session.ts'
import {
  ActualRuntime,
  type InvokeOptions,
  type RuntimeConfig,
  type RuntimeDeps,
} from './runtime.ts'

/** 参与运行时构造的字段子集：变化即重建（其余字段热取即可）。 */
function cliSignatureOf(config: ActualConfig): string {
  return JSON.stringify([
    config.cliCommand,
    config.serverUrl,
    config.password,
    config.sessionToken,
    config.encryptionPassword,
    config.syncId,
    config.dataDir,
    config.cacheTtl,
    config.lockTimeout,
    config.cliVersionPolicy,
    config.allow,
    config.deny,
    config.toolCallTimeoutMs,
  ])
}

/**
 * `ctx.actual` 服务：预设子插件（及测试）消费的唯一入口。
 * 构造即建运行时；fiber 卸载经 dispose 释放会话与重连定时器。
 */
export class ActualService extends Service {
  private runtime: ActualRuntime
  private detach: () => void
  private signature: string
  private readonly listeners = new Set<(manifest: ActualManifest) => void>()
  private readonly current: () => ActualConfig
  private readonly deps: RuntimeDeps
  private readonly logger: ReturnType<Context['logger']>

  constructor(ctx: Context, config: ActualConfig | ActualConfigFields) {
    super(ctx, 'actual')
    // 配置为活动引用：现取即热，替代按需重建之外的任何缓存。
    this.current = () => unwrapVolatile(config) as ActualConfig
    this.logger = ctx.logger('actual')
    this.deps = {
      ...createNodeDeps(),
      createSession: (entries, invoke) =>
        createInProcessSession(entries, invoke, this.current().toolCallTimeoutMs),
    }
    this.signature = cliSignatureOf(this.current())
    const built = this.build()
    this.runtime = built.runtime
    this.detach = built.detach
    ctx.events.on('loader/volatile-update', () => this.rebuildIfStale())
  }

  /** 按当前配置装配一个运行时，并把清单变更转发给服务级订阅者。 */
  private build(): { runtime: ActualRuntime; detach: () => void } {
    const config = this.current()
    const cli: CliConfig = {
      cliCommand: [...config.cliCommand],
      serverUrl: config.serverUrl,
      password: config.password,
      sessionToken: config.sessionToken,
      syncId: config.syncId,
      dataDir: config.dataDir !== '' ? config.dataDir : pluginDataPath('actual', 'cli-data'),
      encryptionPassword: config.encryptionPassword,
      cacheTtl: config.cacheTtl,
      lockTimeout: config.lockTimeout,
    }
    const runtimeConfig: RuntimeConfig = {
      cli,
      allow: [...config.allow],
      deny: [...config.deny],
      cliVersionPolicy: config.cliVersionPolicy,
      toolCallTimeoutMs: config.toolCallTimeoutMs,
    }
    // 密钥按调用即时解析：`cli` 随签名变化换代，闭包始终指向当前那一代配置。
    const deps: RuntimeDeps = {
      ...this.deps,
      resolveSecrets: () => resolveSecrets(this.credentialsSeam(), configSecretsOf(cli)),
    }
    const runtime = new ActualRuntime(runtimeConfig, deps, this.logger)
    const detach = runtime.onChange((manifest) => {
      for (const listener of [...this.listeners]) listener(manifest)
    })
    return { runtime, detach }
  }

  /** 连接相关字段变化 → 重建运行时并按新配置重新发现。 */
  private rebuildIfStale(): void {
    const next = cliSignatureOf(this.current())
    if (next === this.signature) return
    this.signature = next
    const stale = this.runtime
    const staleDetach = this.detach
    const built = this.build()
    this.runtime = built.runtime
    this.detach = built.detach
    stale.dispose()
    staleDetach()
    this.logger.info('Actual 连接配置已更新，运行时已重建')
    void this.runtime.discover().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      this.logger.warn(`按新配置重新发现失败：${detail}`)
    })
  }

  /** 触发一次能力发现（单飞；失败抛错，由调用方告警处理）。 */
  discover(): Promise<ActualManifest> {
    return this.runtime.discover()
  }

  /** 最近一次成功发现的清单。 */
  manifest(): ActualManifest | undefined {
    return this.runtime.manifest()
  }

  /** 执行一次能力调用（MCP 优先，CLI 兜底）。 */
  invoke(
    entry: CapabilityEntry,
    args: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<unknown> {
    return this.runtime.invoke(entry, args, options)
  }

  /** 连接与发现状态（已脱敏）。 */
  status(): ActualStatus {
    return this.runtime.status()
  }

  /** 订阅清单变更（跨运行时重建仍有效），返回退订。 */
  onChange(cb: (manifest: ActualManifest) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /**
   * credentials seam：**可选探测**而非硬 inject。
   *
   * 本插件在没挂 `dsh-credentials` 的 profile（headless/dev 精简组合）里也要能
   * 起来，只是密钥退回「行级 Config + CLI 自身继承环境」；且探测发生在每次操作，
   * seam 比本插件晚激活也能自然接上，不必声明时序。
   */
  private credentialsSeam(): CredentialsFace | null {
    const found = (this.ctx as unknown as { get(key: string): unknown }).get('credentials')
    return found === undefined || found === null ? null : (found as CredentialsFace)
  }

  dispose(): void {
    this.listeners.clear()
    this.detach()
    this.runtime.dispose()
  }
}
