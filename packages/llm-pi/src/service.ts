/**
 * 运行时主逻辑：注册/热更新/发现（逐点对齐官方 dsh-llm-pi-ai apply 的模式）。
 *
 * - profiles 回调按原始 config 对象 identity 备忘；配置变更经 volatile 原位提交
 *   （loader/volatile-update 换代快照）传播，下一请求生效
 *   （adapter 快照按 profiles identity 失效）；
 * - route 集或注册时捕获的事实（displayName/retryPolicy）变化 → 原子的
 *   handle.replace 重注册；写入被校验拒绝时保留旧注册（官方同款护栏）；
 * - registerConfigurableProviders + registerModelDiscovery 让插件 route
 *   正常出现在官方 Models 页与"拉取可用模型"动作里。
 *
 * 模型目录唯一来自 pi-ai 内置目录（随已装 dsh 自动跟随），故无目录拉取/缓存；
 * 运行期事实（生效版本、协议集合、目录规模、逐项降级诊断）经 kitInfo() 供配置页展示。
 * 各步骤各拆成独立工厂函数（套件加载 / profiles 备忘 / adapter / 注册 / 目录），
 * startRuntime 只负责编排。
 * @module llm-pi/service
 */
import type { Context } from '@deepseek-ai/cordis'
// 平台类型面：profileContext.installAnchor（dsh 安装锚点，桌面端关键来源）。
// 纯类型导入，按开发规范仅需 devDeps。
import type {} from '@deepseek-ai/dsh-app-boot'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { DirectoryRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { hasVolatileRefs, unwrapVolatile } from '@dsh-plus/shared'

import { buildApiIndex, listModelInfos, listProviders } from './catalog/browse.ts'
import { compatTableInfo } from './compat.ts'
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
import { type KitVersions, piAiVersionNotice, VERIFIED_PI_AI_RANGE } from './kit-meta.ts'
import {
  createOfficialCopyWriter,
  type OfficialCopyStatus,
  readManualProviders,
} from './official-copy-writer.ts'
import { assertServiceable, buildProfiles, isDraftRoute } from './profiles.ts'
import { buildDeepseekRoutes, type ResolvedDeepseekRoute } from './profiles-deepseek.ts'
import { type DshKit, resolveDshKit } from './resolve-dsh.ts'

/** 配置页「运行期状态」所需的事实（纯 JSON，可直接进 HTTP 响应）。 */
export interface LlmPiKitInfo {
  /** 套件来源：dsh-tree / vendored。 */
  source: string
  /** 套件所在根（dsh 安装树根或 vendored 副本目录）。 */
  root?: string
  /** 实际生效版本（不是 manifest 上写的版本）。 */
  versions: KitVersions
  /** 本插件验证过的 pi-ai 区间（仅提示）。 */
  verifiedRange: string
  /** 生效版本超出验证区间时的提示文案；区间内/版本未知时省略。 */
  versionNotice?: string
  /** 当前可服务的线协议。 */
  protocols: string[]
  /** 协议集合来源：official（官方 supportedProtocols()）/ fallback（内置三元组）。 */
  protocolSource: string
  /** 内置目录规模与数据生成时间。 */
  catalog: { providers: number; models: number; generatedAt?: number }
  /** compat 门控表来源：official / fallback。 */
  compatSource: string
  /** 官方应急副本状态（路径/生成时间/覆盖 route/警告；error = 最近生成失败）。 */
  officialCopy: OfficialCopyStatus
  /** 回退与逐项降级诊断（有内容时界面显式展示）。 */
  diagnostics: string[]
}

export interface LlmPiRuntime {
  /** 当前生效配置（settings 用户层解析结果或 cordis 行级 config）。 */
  currentConfig(): LlmPiConfig
  /** 运行期套件事实（配置卡片状态行 / meta 端点）。 */
  kitInfo(): LlmPiKitInfo
  /** 内置 provider 条目（meta 端点）。 */
  providerEntries(): ReturnType<typeof listProviders>
  /** 紧凑协议索引 `{provider: {modelId: api}}`（卡片推断 route 生效协议）。 */
  apiIndex(): ReturnType<typeof buildApiIndex>
  kit: DshKit
}

type PiAdapter = InstanceType<DshKit['PiAiAdapter']>
type ProfileMap = Map<string, ResolvedPiAiProviderProfile>
type DeepseekMap = Map<string, ResolvedDeepseekRoute>

/** 插件日志窄面（ctx.logger 的消费子集；便于把各步骤拆成独立函数）。 */
interface PluginLogger {
  info(message: string): void
  warn(message: unknown): void
  error(message: unknown): void
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

/** 解析运行期套件并落启动日志（来源/生效版本/协议/逐项降级诊断）。 */
async function loadRuntimeKit(
  ctx: Context,
  logger: PluginLogger,
): Promise<{ kit: DshKit; diagnostics: string[] }> {
  const { kit, diagnostics } = await resolveDshKit(ctx.get('profileContext')?.installAnchor)
  for (const line of diagnostics) logger.warn(line)
  logger.info(
    `运行时套件来源：${kit.source}；pi-ai ${kit.versions.piAi ?? '?'} / ` +
      `dsh-llm-pi-ai ${kit.versions.piAiAdapter ?? '?'}；协议 ${kit.protocols.join('/')}`,
  )
  const versionNotice = piAiVersionNotice(kit.versions.piAi)
  if (versionNotice !== undefined) logger.warn(versionNotice)
  return { kit, diagnostics }
}

/**
 * profiles / deepseek 路由解析器：按原始 config 对象 identity 备忘（官方同款模式）。
 * 运行期走 lenient：目录漂移时降级/跳过并告警，而非抛错弄挂整个 route。
 */
function createProfileResolvers(options: {
  kit: DshKit
  current: () => LlmPiConfig
  logger: PluginLogger
}): { profiles(): ProfileMap; deepseekRoutes(): DeepseekMap } {
  const { kit, current, logger } = options
  let lastRaw: LlmPiConfig | undefined
  let memoized: ProfileMap | undefined
  let memoizedDeepseek: DeepseekMap | undefined
  const profiles = (): ProfileMap => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = raw.enabled
      ? buildProfiles(raw.providers, {
          kit,
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
  const deepseekRoutes = (): DeepseekMap => {
    profiles()
    return memoizedDeepseek ?? new Map()
  }
  return { profiles, deepseekRoutes }
}

/** 构造 PiAiAdapter（官方给出的接缝全部接上）。 */
function createAdapter(options: {
  ctx: Context
  kit: DshKit
  profiles(): ProfileMap
  logger: PluginLogger
}): PiAdapter {
  const { ctx, kit, profiles, logger } = options
  return new kit.PiAiAdapter({
    profiles,
    resolveApiKey: makeResolveApiKey(ctx, kit),
    resolveAttachments: () => ctx.get('attachments'),
    // 官方 auth 助手只在 src 子路径导出：登录/OAuth 类 provider 与 pi-ai 自有
    // 凭据写入的落点。dsh 树 dev 布局（src/auth.ts 存在）时为官方助手，
    // 其余形态为内联等价实现（resolve-dsh.ts 探测，见 auth-inline.ts）。
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
}

/**
 * 注册 handle 组。正常路径单个 handle 整批注册/替换；整批注册遇
 * DUPLICATE_ADAPTER（route 名与其他 adapter 冲突）时降级为逐个注册，
 * 跳过冲突 route——启动不再 fail-loud，其余 route 照常服务。
 */
function createRegistrationController(options: {
  ctx: Context
  adapter: PiAdapter
  profiles(): ProfileMap
  logger: PluginLogger
}): { ensureRegistration(): void } {
  const { ctx, adapter, profiles, logger } = options
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
    const resolved = profiles()
    const facts = registrationFacts(resolved)
    if (deepEqualJson(facts, registeredFacts)) return
    const routes = [...resolved.keys()]
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
  return { ensureRegistration }
}

/**
 * 可配置 provider 目录（pi 路由 + deepseek 路由 + 草稿路由）。
 * 草稿路由从原始配置直读——它们不进 adapter profiles。
 */
function createDirectoryController(options: {
  ctx: Context
  kit: DshKit
  current: () => LlmPiConfig
  profiles(): ProfileMap
  deepseekRoutes(): DeepseekMap
  logger: PluginLogger
}): { ensureDirectory(): void } {
  const { ctx, kit, current, profiles, deepseekRoutes, logger } = options
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
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
      // 空目录不可注册（INVALID_DIRECTORY）；等 settings 用户层供数后再注册
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
  return { ensureDirectory }
}

/** 跑一步热更新动作，失败只告警（保留此前注册/目录）。 */
function attempt(logger: PluginLogger, message: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    logger.error(message)
    logger.error(error)
  }
}

/** 启动插件运行时：解析套件、挂载注册/发现/settings 联动。 */
export async function startRuntime(
  ctx: Context,
  rawConfig: LlmPiConfig | LlmPiConfigFields,
): Promise<LlmPiRuntime> {
  const logger = ctx.logger('llm-pi')
  // cordis 行级 config 可能未经 schema 解析（insert 行无 config 键时为原始空对象），
  // 在此统一规范化；loader 解析出的 volatile 活动字段形态直接透传
  // （hasVolatileRefs 辨识——重复校验会把引用再包一层、破坏 loader 原位提交）。
  const fields: LlmPiConfigFields = hasVolatileRefs(rawConfig)
    ? (rawConfig as LlmPiConfigFields)
    : Config((rawConfig ?? {}) as LlmPiConfigInput)
  const { kit, diagnostics } = await loadRuntimeKit(ctx, logger)

  // 活动引用解包出平面快照：identity 仅在 volatile-update 重解包时换代
  // （profiles 备忘依赖 raw === lastRaw；非 volatile 变更走 fiber reload 整树重建）。
  let snapshot = unwrapVolatile(fields)
  const current: () => LlmPiConfig = () => snapshot
  const deps = { kit }
  const { profiles, deepseekRoutes } = createProfileResolvers({ kit, current, logger })
  profiles() // 行级 config 不可服务则启动即失败（官方同款 fail-fast）

  const adapter = createAdapter({ ctx, kit, profiles, logger })
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

  const { ensureRegistration } = createRegistrationController({ ctx, adapter, profiles, logger })
  const { ensureDirectory } = createDirectoryController({
    ctx,
    kit,
    current,
    profiles,
    deepseekRoutes,
    logger,
  })
  const deepseekRegistrar = new DeepseekRouteRegistrar({
    ctx,
    kit,
    logger: { warn: (m) => logger.warn(m), error: (m) => logger.error(m) },
    routes: deepseekRoutes,
  })
  const ensureDeepseek = (): void => deepseekRegistrar.sync(deepseekRoutes())

  // 官方应急副本：启动即生成一次；热更新与 adapter 注册变化（官方 llm-pi-ai
  // 晚注册时手写条目在此补入）再生成。写失败只降级为状态，不影响路由注册。
  const copyWriter = createOfficialCopyWriter({
    kit,
    current,
    readManual: () => readManualProviders(ctx.settings),
    profile: ctx.get('profileContext')?.name,
    logger,
  })

  ensureRegistration()
  ensureDeepseek()
  ensureDirectory()
  void copyWriter.ensureOfficialCopy()

  // 替代 installSection（validate/setSource/onChange 三钩子）：
  // - 活动引用原位提交 → volatile-update 触发快照换代与重注册（原 onChange 体）；
  // - internal/config waterfall 承接写入校验（原 validate；官方 llm-pi-ai
  //   同款）：configEditor.edit 落盘前先跑 waterfall，handler throw 即拒绝整笔写入。
  const reconfigure = (): void => {
    snapshot = unwrapVolatile(fields)
    attempt(logger, 'llm-pi: 更新被拒，保留此前注册的 route', ensureRegistration)
    attempt(logger, 'llm-pi: deepseek route 更新失败，保留此前注册', ensureDeepseek)
    attempt(logger, 'llm-pi: 更新被拒，保留此前的 configurable-provider 目录', ensureDirectory)
    void copyWriter.ensureOfficialCopy()
  }
  ctx.events.on('loader/volatile-update', reconfigure)
  // 官方 llm-pi-ai 晚于本插件注册时，describe 的手写条目视图此时才完整——
  // adapter 集变化即重新生成副本（无 provider 变化时内容未变、跳过写盘）。
  ctx.root.on('llm/adapters-updated', () => void copyWriter.ensureOfficialCopy())
  ctx.on('internal/config', function (_raw: unknown, next: () => unknown) {
    const candidate = next()
    if (this !== ctx.fiber) return candidate
    assertServiceable(unwrapVolatile(Config(candidate as LlmPiConfigInput)), deps)
    return candidate
  })

  /** 目录规模：按需从当前套件的 provider/模型清单汇总（不缓存，随套件固定）。 */
  const kitInfo = (): LlmPiKitInfo => {
    const providers = listProviders(kit)
    const generatedAt = kit.catalogGeneratedAt
    const notice = piAiVersionNotice(kit.versions.piAi)
    const copy = copyWriter.status()
    return {
      source: kit.source,
      ...(kit.root === undefined ? {} : { root: kit.root }),
      versions: kit.versions,
      verifiedRange: VERIFIED_PI_AI_RANGE,
      ...(notice === undefined ? {} : { versionNotice: notice }),
      protocols: kit.protocols,
      protocolSource: kit.protocolSource,
      catalog: {
        providers: providers.length,
        models: providers.reduce((total, entry) => total + entry.modelCount, 0),
        ...(generatedAt === undefined ? {} : { generatedAt }),
      },
      compatSource: compatTableInfo().source,
      officialCopy: copy,
      diagnostics: [
        ...diagnostics,
        ...copy.warnings.map((warning) => `应急副本：${warning}`),
        ...(copy.error === undefined ? [] : [`应急副本：生成失败（${copy.error}）`]),
      ],
    }
  }

  return {
    currentConfig: () => current(),
    kitInfo,
    providerEntries: () => listProviders(kit),
    apiIndex: () => buildApiIndex(listModelInfos(kit)),
    kit,
  }
}
