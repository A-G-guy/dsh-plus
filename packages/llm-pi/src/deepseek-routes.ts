/**
 * deepseek 路由注册器：每条 adapter: deepseek 的 route 一个官方
 * DeepSeekAdapter 实例（baseURL 各异，无法共享实例），注册到独立路由名。
 *
 * 与官方 deepseek-official 渠道的隔离：
 * - 路由名独立（重复名注册冲突时跳过并告警，不互相覆盖）；
 * - 文件索引作用域 = sha256(baseURL + apiKey)（官方实现），中转与官方天然分池；
 * - 适配器实例、连接事实、重试策略各自独立。
 *
 * 热更新：适配器 options thunk 每次操作重读当前物化产物（连接事实变化下一
 * 请求生效）；retryPolicy 是注册期捕获事实，变化时 handle.replace 原地重注册
 * （官方同款模式）；route 移除即 dispose 释放路由名。
 *
 * 0.1.2-alpha 线：DeepSeekAdapterOptions 必需 prepareExtensions（官方接线
 * ctx.get('deepseekLlmApiExtensions')，缺省空实现）与可选 resolveImageAccess。
 * @module llm-pi/deepseek-routes
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'

import type { ResolvedDeepseekRoute } from './profiles-deepseek.ts'
import type { DshKit } from './resolve-dsh.ts'

interface RouteRegistration {
  handle: AdapterRegistrationHandle
  /** 注册期捕获的重试策略（变化才 replace）。 */
  retryPolicy: unknown
  /** 注册期捕获的展示名（providerInfo 是注册期捕获事实，变化才 replace）。 */
  displayName: string
}

export interface DeepseekRegistrarDeps {
  ctx: Context
  kit: DshKit
  logger: {
    warn(message: string): void
    error(message: string | unknown): void
  }
  /** 当前物化产物表（service 层按 config identity 备忘）。 */
  routes: () => Map<string, ResolvedDeepseekRoute>
}

/** 凭据解析（逐行对齐官方 llm-deepseek resolveApiKey）：凭据服务优先，启动环境兜底。 */
function makeResolveApiKey(ctx: Context, kit: DshKit) {
  return async (connection: { apiKeyEnv: unknown }): Promise<string> => {
    const ref = connection.apiKeyEnv as CredentialRef
    const credentials = ctx.get('credentials')
    const hit =
      credentials !== undefined
        ? (await credentials.resolve(ref))?.value
        : launchEnvironmentOf(ctx).get(ref as unknown as string)?.value
    if (hit !== undefined && hit.length > 0) {
      return kit.assertUsableApiKey(hit, 'llm-pi', ref as unknown as string)
    }
    throw new kit.LlmError(
      `llm-pi: deepseek route 的凭据引用 ${String(ref)} 未解析到值——` +
        '请经凭据服务（web Models 页）存放或导出环境变量',
      'MISSING_CREDENTIAL',
    )
  }
}

export class DeepseekRouteRegistrar {
  private readonly deps: DeepseekRegistrarDeps
  private readonly registrations = new Map<string, RouteRegistration>()
  private readonly resolveApiKey: (connection: { apiKeyEnv: unknown }) => Promise<string>
  private userId: unknown

  constructor(deps: DeepseekRegistrarDeps) {
    this.deps = deps
    this.resolveApiKey = makeResolveApiKey(deps.ctx, deps.kit)
  }

  /** 同步注册表与目标 route 集：新增注册、移除 dispose、retryPolicy 变化原地 replace。 */
  sync(target: Map<string, ResolvedDeepseekRoute>): void {
    for (const [route, registration] of this.registrations) {
      if (target.has(route)) continue
      registration.handle()
      this.registrations.delete(route)
      this.deps.logger.warn(`llm-pi: deepseek route "${route}" 已随配置移除而注销`)
    }
    for (const [route, built] of target) {
      const existing = this.registrations.get(route)
      if (existing !== undefined) {
        this.refreshRegistration(route, built, existing)
        continue
      }
      this.register(route, built)
    }
  }

  /** retryPolicy 或 displayName 变化时原地 replace（两者均为注册期捕获事实）。 */
  private refreshRegistration(
    route: string,
    built: ResolvedDeepseekRoute,
    registration: RouteRegistration,
  ): void {
    const policyUnchanged = deepEqualJson(built.connection.retryPolicy, registration.retryPolicy)
    const nameUnchanged = built.displayName === registration.displayName
    if (policyUnchanged && nameUnchanged) return
    try {
      registration.handle.replace([route])
      registration.retryPolicy = built.connection.retryPolicy
      registration.displayName = built.displayName
    } catch (error) {
      this.deps.logger.error(`llm-pi: deepseek route "${route}" 注册事实更新被拒，保留此前注册`)
      this.deps.logger.error(error)
    }
  }

  /** 匿名用户 id（首次调用时生成并备忘；register 前已确认 kit.deepseek 存在）。 */
  private resolveUserId(): unknown {
    if (this.userId === undefined) {
      this.userId = this.deps.kit.deepseek?.getOrCreateAnonymousUserId()
    }
    return this.userId
  }

  private register(route: string, built: ResolvedDeepseekRoute): void {
    const { ctx, kit, logger, routes } = this.deps
    if (kit.deepseek === undefined) return // 构建期已拦截；此处只是类型护栏
    const adapter = new kit.deepseek.DeepSeekAdapter({
      options: () => {
        const current = routes().get(route)
        if (current === undefined) {
          throw new kit.LlmError(`llm-pi: deepseek route "${route}" 已注销`, 'INVALID_REQUEST')
        }
        return current.connection
      },
      resolveApiKey: this.resolveApiKey as never,
      resolveUserId: () => this.resolveUserId() as never,
      resolveAttachments: () => ctx.get('attachments') as never,
      // 附件宿主路径 → 模型工具执行世界只读路径桥（官方接线同款，见
      // llm-deepseek/src/index.ts:447-452）。
      resolveImageAccess: (attachments, ref) =>
        kit.resolveImageAttachmentAccess(
          attachments,
          (hostPath) =>
            (
              ctx.get('fs') as
                | { processPathFromHostPath(hostPath: string): string | undefined }
                | undefined
            )?.processPathFromHostPath(hostPath),
          ref,
        ) as never,
      // 0.1.2-alpha 线必需：官方扩展注册表（deepseekLlmApiExtensions）缺席时
      // 给空实现（官方接线范式，llm-deepseek/src/index.ts:404-470）。
      prepareExtensions: (request) => {
        const extensions = ctx.get('deepseekLlmApiExtensions') as
          | { prepare(request: unknown): Promise<unknown> }
          | undefined
        return (extensions?.prepare(request) ??
          Promise.resolve({ fields: {}, accept: () => Promise.resolve() })) as never
      },
    })
    // 官方 providerInfo 硬编码 name: "DeepSeek"——覆盖为按路由动态读取的
    // displayName，否则自定义 deepseek 路由在模型选择器里与 deepseek-official
    // 撞名（两个 "DeepSeek" 分组，无法区分）。
    adapter.providerInfo = (provider: string) => ({
      id: provider,
      name: routes().get(route)?.displayName ?? built.displayName,
    })
    try {
      const handle = ctx.llm.registerAdapter([route], adapter as never)
      this.registrations.set(route, {
        handle,
        retryPolicy: built.connection.retryPolicy,
        displayName: built.displayName,
      })
    } catch (error) {
      logger.error(
        `llm-pi: deepseek route "${route}" 注册失败（可能与其他 adapter 重名），该 route 不可用`,
      )
      logger.error(error)
    }
  }
}
