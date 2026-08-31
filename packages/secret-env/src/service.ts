/**
 * secret-env 服务主体（host 半）：
 * - 全局臂：值经 dsh-credentials seam 持久（$DSH_HOME/.credentials.yaml），
 *   服务内存中维护同步镜像（contributor.resolve 是同步签名，无法现查异步 seam）；
 * - 会话臂：Map<SessionId, Map<后缀, 值>> 纯内存，session/disposed 清除；
 * - 注入臂：每个变量名一个 dsh-shell-env contributor，每次 shell 执行由
 *   注册表 collect 现取——写入/删除下一条命令即生效，不进消息流、不动前缀。
 *
 * 红线：值只流经「端点 → 本服务 → dshEnv」，任何日志/事件/返回值不带值。
 * @module secret-env/service
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { type CredentialInfo, credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-shell-env'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

import { registerSecretEnvApi } from './api.ts'
import { Config, type SecretEnvConfig, type SecretMeta } from './config.ts'
import { SecretEnvError } from './errors.ts'
import { envNameOf, suffixOf } from './names.ts'
import { SETTINGS_NS } from './ns.ts'

/** 受管键（结构等价 dsh-shell 的 DshEnvironmentKey，避免仅为类型多挂一个依赖）。 */
type ManagedKey = `DSH_${string}`

/** 一条会话级密钥（内存态；once = 首次注入后自毁）。 */
export interface SessionSecret {
  value: string
  description: string
  once: boolean
  createdAt: string
}

/** 列表端点的全局条目（describe 视图，绝无值）。 */
export interface GlobalEntry {
  name: string
  envName: string
  description: string
  configured: boolean
  source?: string
  writable: boolean
}

/** 列表端点的会话条目。 */
export interface SessionEntry {
  name: string
  envName: string
  description: string
  once: boolean
  createdAt: string
}

interface SettingsLike {
  get(ns: string): unknown
  update(ns: string, patch: Record<string, unknown>): Promise<void>
  installSection(
    ownerCtx: Context,
    ns: string,
    schema: unknown,
    base: unknown,
    hooks: { setSource(source: () => unknown): void; onChange(): void },
  ): void
}

function asMeta(value: unknown): SecretMeta[] {
  if (value === undefined || value === null || typeof value !== 'object') return []
  const list = (value as { secrets?: unknown }).secrets
  if (!Array.isArray(list)) return []
  return list
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      description: typeof item.description === 'string' ? item.description : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    }))
    .filter((item) => item.name.length > 0)
}

export class SecretEnvService extends Service {
  static [Context.inject] = ['credentials', 'shellEnv']

  /** 全局值镜像（seam resolve 为异步，contributor 同步读这里）。 */
  private readonly globalMirror = new Map<string, string>()
  /** 会话桶：sessionId → 后缀 → 条目。 */
  private readonly buckets = new Map<string, Map<string, SessionSecret>>()
  /** 变量名 → contributor 注销器（shell-env 要求一键一主）。 */
  private readonly contributors = new Map<string, () => void>()
  /** 行级 config（settings 缺席时的索引来源）。 */
  private readonly base: SecretEnvConfig
  /** installSection 给的实时 getter（scope.get 的活视图，读即最新，无时序竞态）。 */
  private readIndex: (() => unknown) | undefined
  /** 上次调和时的索引快照（onChange 差量用）。 */
  private lastMeta: SecretMeta[] = []
  private settingsRef: SettingsLike | undefined
  /** 启动镜像建立完成（测试与需要确定性的调用方可等待）。 */
  readonly ready: Promise<void>

  constructor(ctx: Context, config: SecretEnvConfig | undefined) {
    super(ctx, 'secretEnv')
    this.base = config ?? { secrets: [] }
    // 官方 installSection 范式（同 usage-panel）：setSource 收到的是
    // () => scope.get() 活视图——索引读取永远走 currentMeta() 现取，
    // onChange 仅触发差量调和，因此用户层加载早晚都不会被写覆盖。
    ctx.inject(['settings'], (settingsCtx) => {
      const settings = settingsCtx.settings as unknown as SettingsLike
      settings.installSection(ctx, SETTINGS_NS, Config, this.base, {
        setSource: (source) => {
          this.readIndex = source
        },
        onChange: () => {
          void this.reconcile()
        },
      })
      this.settingsRef = settings
      void this.reconcile()
    })
    ctx.root.on('session/disposed', (session: { id: string }) => {
      this.dropBucket(session.id)
    })
    ctx.on('credentials/reference-updated', (ref) => {
      const suffix = suffixOf(String(ref))
      // 非索引名不注入：索引是"本插件管理哪些全局名"的唯一事实源。
      if (suffix !== undefined && this.isIndexed(suffix)) void this.refreshMirror(suffix)
    })
    ctx.inject(['webServer'], (webCtx) => {
      registerSecretEnvApi(webCtx as Context, this)
    })
    this.ready = this.reconcile()
  }

  /** 当前生效索引（settings 活视图优先，缺席回落行级 config）。 */
  private currentMeta(): SecretMeta[] {
    return asMeta(this.readIndex !== undefined ? this.readIndex() : this.base)
  }

  /** 索引成员判定（索引是全局名管理面的唯一事实源）。 */
  private isIndexed(suffix: string): boolean {
    return this.currentMeta().some((item) => item.name === suffix)
  }

  /** 索引差量调和：新名建镜像，移出名撤镜像并回收其独占的 contributor。 */
  private async reconcile(): Promise<void> {
    const next = this.currentMeta()
    const removed = this.lastMeta.filter((item) => !next.some((n) => n.name === item.name))
    const added = next.filter((item) => !this.lastMeta.some((p) => p.name === item.name))
    this.lastMeta = next
    for (const item of removed) {
      this.globalMirror.delete(item.name)
      this.syncContributor(item.name)
    }
    for (const item of added) {
      await this.refreshMirror(item.name)
    }
  }

  /** 重新 resolve 一个全局名并同步镜像与 contributor（外部热编辑亦走此路）。 */
  private async refreshMirror(suffix: string): Promise<void> {
    const resolved = await this.ctx.credentials.resolve(credentialRef(envNameOf(suffix)))
    if (resolved === undefined) {
      this.globalMirror.delete(suffix)
    } else {
      this.globalMirror.set(suffix, resolved.value)
    }
    this.syncContributor(suffix)
  }

  /** contributor 登记簿：有任一来源（全局镜像或任一会话桶）则注册，否则注销。 */
  private syncContributor(suffix: string): void {
    const envName = envNameOf(suffix)
    const hasGlobal = this.globalMirror.has(suffix)
    let hasSession = false
    for (const bucket of this.buckets.values()) {
      if (bucket.has(suffix)) {
        hasSession = true
        break
      }
    }
    const registered = this.contributors.has(envName)
    if ((hasGlobal || hasSession) && !registered) {
      this.registerContributor(suffix, envName)
      return
    }
    if (!hasGlobal && !hasSession && registered) {
      this.contributors.get(envName)?.()
      this.contributors.delete(envName)
    }
  }

  private registerContributor(suffix: string, envName: string): void {
    // 注册表拒绝空描述（"must describe"）；空白描述回落为通用文案。
    const found = this.currentMeta().find((item) => item.name === suffix)?.description
    const description = found !== undefined && found.trim() !== '' ? found : 'secret variable'
    try {
      const dispose = this.ctx.shellEnv.register({
        name: `secret-env:${suffix}`,
        variables: { [envName as ManagedKey]: { description } },
        resolve: (execution: ToolExecution) => {
          const value = this.resolveFor(suffix, execution)
          return value === undefined ? {} : { [envName as ManagedKey]: value }
        },
      })
      this.contributors.set(envName, dispose)
    } catch (error) {
      throw new SecretEnvError(
        'conflict',
        `variable ${envName} conflicts with an existing contributor: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** 注入解析：会话值优先，未命中回落全局镜像；once 命中即焚（注销推迟到微任务，避免 collect 迭代中改注册表）。 */
  private resolveFor(suffix: string, execution: ToolExecution): string | undefined {
    const sessionId = execution.agent?.id
    const bucket = sessionId === undefined ? undefined : this.buckets.get(String(sessionId))
    const entry = bucket?.get(suffix)
    if (entry !== undefined) {
      if (entry.once && bucket !== undefined) {
        bucket.delete(suffix)
        queueMicrotask(() => this.syncContributor(suffix))
      }
      return entry.value
    }
    return this.globalMirror.get(suffix)
  }

  /** 会话终结：整桶清除并回收其独占的 contributor。 */
  private dropBucket(sessionId: string): void {
    const bucket = this.buckets.get(sessionId)
    if (bucket === undefined) return
    this.buckets.delete(sessionId)
    for (const suffix of bucket.keys()) {
      this.syncContributor(suffix)
    }
  }

  private async persistMeta(next: SecretMeta[]): Promise<void> {
    if (this.settingsRef === undefined) return
    await this.settingsRef.update(SETTINGS_NS, { secrets: next })
  }

  /** 列表（值永不出现；global 条目来自 credentials.describe 的安全视图）。 */
  async list(sessionId?: string): Promise<{ global: GlobalEntry[]; session: SessionEntry[] }> {
    const global = await Promise.all(
      this.currentMeta().map(async (item) => {
        const info: CredentialInfo = await this.ctx.credentials.describe(
          credentialRef(envNameOf(item.name)),
        )
        return {
          name: item.name,
          envName: envNameOf(item.name),
          description: item.description,
          configured: info.configured,
          source: info.source,
          writable: info.writable,
        }
      }),
    )
    const bucket = sessionId === undefined ? undefined : this.buckets.get(sessionId)
    const session: SessionEntry[] = [...(bucket?.entries() ?? [])].map(([name, entry]) => ({
      name,
      envName: envNameOf(name),
      description: entry.description,
      once: entry.once,
      createdAt: entry.createdAt,
    }))
    return { global, session }
  }

  /** 写入全局值（seam 拒绝继承环境遮蔽与空值，此处先行给出结构化错误）。 */
  async setGlobal(suffix: string, value: string, description: string): Promise<void> {
    if (value.length === 0) throw new SecretEnvError('empty-value', 'value must not be empty')
    try {
      await this.ctx.credentials.set(credentialRef(envNameOf(suffix)), value)
    } catch (error) {
      throw new SecretEnvError('shadowed', error instanceof Error ? error.message : String(error))
    }
    const meta = this.currentMeta()
    const existing = meta.find((item) => item.name === suffix)
    const next =
      existing === undefined
        ? [...meta, { name: suffix, description, createdAt: new Date().toISOString() }]
        : meta.map((item) => (item.name === suffix ? { ...item, description } : item))
    await this.persistMeta(next)
    this.lastMeta = next
    await this.refreshMirror(suffix)
  }

  /** 删除全局值与元数据。 */
  async unsetGlobal(suffix: string): Promise<void> {
    await this.ctx.credentials.unset(credentialRef(envNameOf(suffix)))
    const next = this.currentMeta().filter((item) => item.name !== suffix)
    await this.persistMeta(next)
    this.lastMeta = next
    this.globalMirror.delete(suffix)
    this.syncContributor(suffix)
  }

  /** 写入会话级值（纯内存；host 重启或会话终结即失）。 */
  setSession(
    sessionId: string,
    suffix: string,
    value: string,
    description: string,
    once: boolean,
  ): void {
    if (sessionId.length === 0) throw new SecretEnvError('no-session', 'sessionId required')
    if (value.length === 0) throw new SecretEnvError('empty-value', 'value must not be empty')
    const bucket = this.buckets.get(sessionId) ?? new Map<string, SessionSecret>()
    bucket.set(suffix, { value, description, once, createdAt: new Date().toISOString() })
    this.buckets.set(sessionId, bucket)
    this.syncContributor(suffix)
  }

  /** 删除会话级值。 */
  unsetSession(sessionId: string, suffix: string): void {
    const bucket = this.buckets.get(sessionId)
    if (bucket === undefined || !bucket.delete(suffix)) return
    if (bucket.size === 0) this.buckets.delete(sessionId)
    this.syncContributor(suffix)
  }

  dispose(): void {
    for (const disposeContributor of this.contributors.values()) {
      disposeContributor()
    }
    this.contributors.clear()
  }
}
