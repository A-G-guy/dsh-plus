/**
 * 运行时主逻辑：注册/热更新/发现（逐点对齐官方 dsh-llm-pi-ai apply 的模式）。
 *
 * - profiles 回调按原始 config 对象 identity 备忘；配置变更经 0.1.7
 *   volatile 原位提交（loader/volatile-update 换代快照）传播，下一请求生效
 *   （adapter 快照按 profiles identity 失效）；
 * - route 集或注册时捕获的事实（displayName/retryPolicy）变化 → 原子的
 *   handle.replace 重注册；写入被校验拒绝时保留旧注册（官方同款护栏）；
 * - registerConfigurableProviders + registerModelDiscovery 让插件 route
 *   正常出现在官方 Models 页与"拉取可用模型"动作里。
 * @module llm-pi/service
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { DirectoryRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { hasVolatileRefs, pluginDataPath, unwrapVolatile } from '@dsh-plus/shared'

import { ModelsDevSource } from './catalog/models-dev.ts'
import {
  Config,
  type LlmPiConfig,
  type LlmPiConfigFields,
  type LlmPiConfigInput,
  SETTINGS_NS,
} from './config.ts'
import { DeepseekRouteRegistrar } from './deepseek-routes.ts'
import { buildDirectoryEntries, commitDirectory, type DirectoryEntry } from './directory.ts'
import { discoverModels } from './discovery.ts'
import { assertServiceable, buildProfiles, isDraftRoute } from './profiles.ts'
import { buildDeepseekRoutes, type ResolvedDeepseekRoute } from './profiles-deepseek.ts'
import { type DshKit, resolveDshKit } from './resolve-dsh.ts'

export interface LlmPiRuntime {
  /** 当前生效配置（settings 用户层解析结果或 cordis 行级 config）。 */
  currentConfig(): LlmPiConfig
  /** 运行时套件来源（dsh-tree / vendored）与回退诊断。 */
  kitInfo(): { source: string; diagnostics: string[] }
  /** models.dev 兜底源（配置卡片读状态用）。 */
  modelsDev: ModelsDevSource
  kit: DshKit
}

/** 注册时捕获的事实表；变化才重注册（按 provider 排序，免序误报）。 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>) {
  return [...profiles.entries()]
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/** 凭据解析（逐行对齐官方 resolveApiKey）：凭据服务优先，缺失时启动环境兜底。 */
function makeResolveApiKey(ctx: Context, kit: DshKit) {
  return async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit =
      credentials !== undefined
        ? (await credentials.resolve(ref as CredentialRef))?.value
        : launchEnvironmentOf(ctx).get(ref as unknown as string)?.value
    if (hit !== undefined && hit.length > 0)
      return kit.assertUsableApiKey(hit, 'llm-pi', ref as unknown as string)
    throw new kit.LlmError(
      `llm-pi: provider route "${provider}" 的凭据引用 ${String(ref)} 未解析到值——` +
        '请经凭据服务（web Models 页）存放或导出环境变量；仅当该 provider 应使用 pi-ai 自有环境发现时才移除 apiKeyEnv',
      'MISSING_CREDENTIAL',
    )
  }
}

/** 启动插件运行时：解析套件、挂载注册/发现/settings 联动。 */
export async function startRuntime(
  ctx: Context,
  rawConfig: LlmPiConfig | LlmPiConfigFields,
): Promise<LlmPiRuntime> {
  const logger = ctx.logger('llm-pi')
  // cordis 行级 config 可能未经 schema 解析（insert 行无 config 键时为原始空对象），
  // 在此统一规范化；0.1.7 loader 解析出的 volatile 活动字段形态直接透传
  // （hasVolatileRefs 辨识——重复校验会把引用再包一层、破坏 loader 原位提交）。
  const fields: LlmPiConfigFields = hasVolatileRefs(rawConfig)
    ? (rawConfig as LlmPiConfigFields)
    : Config((rawConfig ?? {}) as LlmPiConfigInput)
  const { kit, diagnostics } = await resolveDshKit()
  for (const line of diagnostics) logger.warn(line)
  logger.info(`运行时套件来源：${kit.source}`)

  // 活动引用解包出平面快照：identity 仅在 volatile-update 重解包时换代
  // （profiles 备忘依赖 raw === lastRaw；非 volatile 变更走 fiber reload 整树重建）。
  let snapshot = unwrapVolatile(fields)
  const modelsDev = new ModelsDevSource(
    pluginDataPath('llm-pi', 'models-dev.json'),
    snapshot.catalogUrl,
    snapshot.catalogRefreshHours,
    (message) => logger.warn(message),
    snapshot.catalogProxy ?? '',
  )
  void modelsDev.ensureLoaded()

  const current: () => LlmPiConfig = () => snapshot
  let lastRaw: LlmPiConfig | undefined
  let memoized: Map<string, ResolvedPiAiProviderProfile> | undefined
  let memoizedDeepseek: Map<string, ResolvedDeepseekRoute> | undefined
  const deps = { kit, modelsDev }
  /** 当前已解析 profiles，按原始 config identity 备忘（官方同款模式）。
   *  运行期走 lenient：数据源漂移时降级/跳过并告警，而非抛错弄挂整个 route。 */
  const profiles = (): Map<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = raw.enabled
      ? buildProfiles(raw.providers, {
          ...deps,
          lenient: true,
          warn: (message) => logger.warn(message),
        })
      : new Map()
    memoizedDeepseek = raw.enabled
      ? buildDeepseekRoutes(raw.providers, {
          kit,
          lenient: true,
          warn: (message) => logger.warn(message),
        })
      : new Map()
    lastRaw = raw
    memoized = next
    return next
  }
  /** deepseek 路由物化表（与 profiles 同一次备忘窗口）。 */
  const deepseekRoutes = (): Map<string, ResolvedDeepseekRoute> => {
    profiles()
    return memoizedDeepseek ?? new Map()
  }
  profiles() // 行级 config 不可服务则启动即失败（官方同款 fail-fast）

  const adapter = new kit.PiAiAdapter({
    profiles,
    resolveApiKey: makeResolveApiKey(ctx, kit),
    resolveAttachments: () => ctx.get('attachments'),
    // 0.1.2-alpha.2 必需（包根仍未导出官方 auth 助手）：登录/OAuth 类 provider 与 pi-ai 自有凭据写入的落点。
    // dsh 树 dev 布局（src/auth.ts 存在）时为官方助手，其余形态为内联等价
    // 实现（resolve-dsh.ts 探测，见 auth-inline.ts）。
    auth: {
      credentials: kit.auth.credentialStoreFrom(ctx),
      authContext: kit.auth.authContextFrom(ctx),
    },
    // 官方接线范式（llm-deepseek/src/index.ts:447-452）：附件宿主路径 →
    // 当前模型工具执行世界的只读路径桥（经 ctx.fs 的 host→执行世界映射）。
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
      ),
    onReplayDegrade: ({ provider, model, reason }) => {
      logger.warn(
        `llm-pi: 助手历史中 "${provider}/${model}" 的回放状态不可用，` +
          `该消息按 provider 中立内容发送（${reason}）`,
      )
    },
  })

  const storedApiKey = async (provider: string | undefined): Promise<string | undefined> => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return makeResolveApiKey(ctx, kit)(provider, profile)
  }
  ctx.llm.registerModelDiscovery(SETTINGS_NS, (request: Parameters<typeof discoverModels>[0]) =>
    discoverModels(request, {
      kit,
      configProviders: () => current().providers ?? {},
      storedApiKey,
    }),
  )

  /**
   * 注册 handle 组。正常路径单个 handle 整批注册/替换；整批注册遇
   * DUPLICATE_ADAPTER（route 名与其他 adapter 冲突）时降级为逐个注册，
   * 跳过冲突 route——启动不再 fail-loud，其余 route 照常服务。
   */
  interface RegistrationGroup {
    routes: string[]
    handle: { replace(routes: string[]): void }
  }
  let registrations: RegistrationGroup[] | undefined
  let registeredFacts: unknown

  const registerGroup = (
    routes: string[],
    fallback: (error: unknown) => void,
  ): RegistrationGroup[] => {
    try {
      const handle = ctx.llm.registerAdapter(routes, adapter as never)
      return [{ routes, handle }]
    } catch (error) {
      fallback(error)
      const groups: RegistrationGroup[] = []
      for (const route of routes) {
        try {
          const handle = ctx.llm.registerAdapter([route], adapter as never)
          groups.push({ routes: [route], handle })
        } catch (routeError) {
          logger.error(
            `llm-pi: route "${route}" 注册失败（可能与其他 adapter 重名），该 route 不可用`,
          )
          logger.error(routeError)
        }
      }
      return groups
    }
  }

  const ensureRegistration = (): void => {
    const current2 = profiles()
    const facts = registrationFacts(current2)
    if (deepEqualJson(facts, registeredFacts)) return
    const routes = [...current2.keys()]
    if (registrations === undefined) {
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registrations = registerGroup(routes, (error) => {
        logger.warn('llm-pi: 整批注册失败（可能 route 名冲突），降级为逐个 route 注册')
        logger.warn(error)
      })
    } else {
      try {
        const [first, ...rest] = registrations
        if (first === undefined) throw new Error('registrations 为空（此前整批注册全部失败）')
        first.handle.replace(routes)
        for (const group of rest) group.handle.replace([])
        registrations = [{ routes, handle: first.handle }]
      } catch (error) {
        // 原子 replace 被拒（含冲突）：保留此前注册（官方同款护栏）
        logger.error('llm-pi: 更新被拒，保留此前注册的 route')
        logger.error(error)
      }
    }
    registeredFacts = facts
  }

  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  /** 草稿路由（无模型占位）从原始配置直读——它们不进 adapter profiles。 */
  const draftRoutes = (): { route: string; displayName: string }[] => {
    const providers = current().providers ?? {}
    return Object.entries(providers)
      .filter(([, profile]) => isDraftRoute(profile))
      .map(([route, profile]) => ({ route, displayName: profile.displayName ?? route }))
  }
  const ensureDirectory = (): void => {
    const entries = buildDirectoryEntries(
      kit,
      SETTINGS_NS,
      profiles(),
      deepseekRoutes(),
      draftRoutes(),
    )
    // 备忘键为目标全集（含被冲突跳过的条目）：目标不变不重复尝试/告警
    if (deepEqualJson(entries, directoryFacts)) return
    if (entries.length === 0) {
      // 空目录不可注册（INVALID_DIRECTORY）；等 settings 用户层供数后在 onChange 注册
      directoryFacts = entries
      return
    }
    commitDirectory(
      (batch: DirectoryEntry[]) => {
        if (directory === undefined) directory = ctx.llm.registerConfigurableProviders(batch)
        else directory.replace(batch)
      },
      entries,
      (message) => logger.warn(message),
    )
    directoryFacts = entries
  }

  const deepseekRegistrar = new DeepseekRouteRegistrar({
    ctx,
    kit,
    logger: { warn: (m) => logger.warn(m), error: (m) => logger.error(m) },
    routes: deepseekRoutes,
  })
  const ensureDeepseek = (): void => deepseekRegistrar.sync(deepseekRoutes())

  ensureRegistration()
  ensureDeepseek()
  ensureDirectory()

  // 0.1.7 替代 installSection（validate/setSource/onChange 三钩子）：
  // - 活动引用原位提交 → volatile-update 触发快照换代与重注册（原 onChange 体）；
  // - internal/config waterfall 承接写入校验（原 validate；官方 llm-pi-ai
  //   同款）：configEditor.edit 落盘前先跑 waterfall，handler throw 即拒绝整笔写入。
  const reconfigure = (): void => {
    snapshot = unwrapVolatile(fields)
    try {
      ensureRegistration()
    } catch (error) {
      logger.error('llm-pi: 更新被拒，保留此前注册的 route')
      logger.error(error)
    }
    try {
      ensureDeepseek()
    } catch (error) {
      logger.error('llm-pi: deepseek route 更新失败，保留此前注册')
      logger.error(error)
    }
    try {
      ensureDirectory()
    } catch (error) {
      logger.error('llm-pi: 更新被拒，保留此前的 configurable-provider 目录')
      logger.error(error)
    }
    const cfg = current()
    modelsDev.reconfigure(cfg.catalogUrl, cfg.catalogRefreshHours, cfg.catalogProxy ?? '')
  }
  ctx.events.on('loader/volatile-update', reconfigure)
  ctx.on('internal/config', function (_raw: unknown, next: () => unknown) {
    const candidate = next()
    if (this !== ctx.fiber) return candidate
    assertServiceable(unwrapVolatile(Config(candidate as LlmPiConfigInput)), deps)
    return candidate
  })

  return {
    currentConfig: () => current(),
    kitInfo: () => ({ source: kit.source, diagnostics }),
    modelsDev,
    kit,
  }
}
