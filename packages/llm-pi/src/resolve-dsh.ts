/**
 * dsh 运行时套件解析：让插件跑在 dsh 当前安装树的同一份
 * dsh-llm-pi-ai / dsh-llm / pi-ai 之上，从而 dsh 升级即自动跟随上游。
 *
 * 解析策略（全部模块同源地整体成功或整体回退，杜绝跨源混用）：
 * 1. dsh-tree：从 process.argv[1]（systemd/CLI 启动的 dsh 即 bin.js  shim，
 *    realpath 后落在 dsh 安装树内）向上找到同时含有
 *    node_modules/@deepseek-ai/dsh-llm-pi-ai 与 node_modules/@earendil-works/pi-ai
 *    的目录，按文件路径动态 import——与 dsh 官方插件共享同一模块实例；
 * 2. vendored：回退到本插件 dependencies 里的固定版本副本（裸 import）。
 *
 * 两条路径产物都过形状自检（assertKitShape）：上游重构导致形状漂移时
 * 抛错，由调用方决定回退或放弃注册——绝不让坏套件进入消息链路。
 *
 * 0.1.2-alpha.1 起的新面（包根未导出、仅 src 子路径有）：
 * - resolveProfiles（config.ts）：官方解析链，dev 布局树可经 src 子路径复用；
 * - credentialStoreFrom/authContextFrom（auth.ts）：PiAiAdapter 必需 auth 注入。
 * npm 发布形态（lib/index.js 单 bundle + 无 src/）两者都拿不到：dsh 树优先
 * 探测 src/*（含 lib/* 候选），未命中时 resolveProfiles 走插件等价实现
 * （profiles.ts，门控表对齐官方 catalog.ts）、auth 走内联等价实现
 * （auth-inline.ts，recordKeyFor 自包根导出同源注入）——形状自检兜底。
 * @module llm-pi/resolve-dsh
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { getOrCreateAnonymousUserId as getAnonIdType } from '@deepseek-ai/dsh-anonymous-user-id'
import * as vendoredAnonId from '@deepseek-ai/dsh-anonymous-user-id'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type * as DshLlm from '@deepseek-ai/dsh-llm'
import * as vendoredLlm from '@deepseek-ai/dsh-llm'
import type {
  DeepSeekAdapter as DeepSeekAdapterType,
  resolveAdapterOptions as resolveDeepSeekOptionsType,
} from '@deepseek-ai/dsh-llm-deepseek'
import * as vendoredDeepseek from '@deepseek-ai/dsh-llm-deepseek'
import type {
  PiAiAdapter as PiAiAdapterType,
  PiAiProviderProfile,
  ResolvedPiAiProviderProfile,
} from '@deepseek-ai/dsh-llm-pi-ai'
import * as vendoredPiAiAdapter from '@deepseek-ai/dsh-llm-pi-ai'
import type * as PiAi from '@earendil-works/pi-ai'
import type { AuthContext, CredentialStore } from '@earendil-works/pi-ai'
import * as vendoredPiAi from '@earendil-works/pi-ai'
import { anthropicMessagesApi as vendoredAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi as vendoredCompletions } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi as vendoredResponses } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import * as vendoredCatalog from '@earendil-works/pi-ai/providers/all'

import {
  authContextFrom as inlineAuthContextFrom,
  credentialStoreFrom as inlineCredentialStoreFrom,
} from './auth-inline.ts'
import type { ProtocolId } from './config.ts'
import { type ResolverDeps, resolveProfilesFallback } from './profiles.ts'

/**
 * deepseek 适配器模块表面（可选）：dsh-llm-deepseek 的官方 DeepSeekAdapter
 * 与目录解析器 + 匿名用户 id。缺失（旧版 dsh 树或形状漂移）不拖垮核心
 * 套件——deepseek 类 route 在构建期以明确错误拒绝，pi 路由不受影响。
 * 与核心套件强制同源（杜绝跨源模块混用：brand/LlmError 恒等性敏感）。
 */
export interface DeepSeekKit {
  DeepSeekAdapter: typeof DeepSeekAdapterType
  resolveAdapterOptions: typeof resolveDeepSeekOptionsType
  getOrCreateAnonymousUserId: typeof getAnonIdType
}

/** profile 解析面（官方 config.ts resolveProfiles 的签名；包根未导出，见文件头）。 */
export type ResolveProfiles = (
  providers: Readonly<Record<string, PiAiProviderProfile>> | undefined,
) => Map<string, ResolvedPiAiProviderProfile>

/** PiAiAdapter 必需 auth 注入的两个助手（官方 auth.ts 面；包根未导出）。 */
export interface AuthHelpers {
  credentialStoreFrom(ctx: Context): CredentialStore
  authContextFrom(ctx: Context): AuthContext
}

/** 插件运行期所需的全部上游模块表面（单一来源，内部一致）。 */
export interface DshKit {
  /** 解析来源：dsh 安装树 / 插件 vendored 兜底副本。 */
  source: 'dsh-tree' | 'vendored'
  PiAiAdapter: typeof PiAiAdapterType
  LlmError: typeof DshLlm.LlmError
  resolveRetryPolicy: typeof DshLlm.resolveRetryPolicy
  attributionHeaders: typeof DshLlm.attributionHeaders
  normalizeApiKey: typeof DshLlm.normalizeApiKey
  assertUsableApiKey: typeof DshLlm.assertUsableApiKey
  INVALID_CREDENTIAL_CODE: string
  createProvider: typeof PiAi.createProvider
  builtinProviders: typeof vendoredCatalog.builtinProviders
  getBuiltinProviders: typeof vendoredCatalog.getBuiltinProviders
  getBuiltinModels: typeof vendoredCatalog.getBuiltinModels
  /** 三协议的 pi-ai api 实现工厂（与官方 PROTOCOLS 表同来源）。 */
  protocolFactories: Record<ProtocolId, () => unknown>
  /**
   * profile 解析链：dsh 树 dev 布局（src/config.ts 存在）时为官方
   * resolveProfiles；npm 形态（无 src）与 vendored 兜底时为插件等价实现。
   */
  resolveProfiles: ResolveProfiles
  /**
   * PiAiAdapter 必需 auth 注入：dsh 树 dev 布局（src/auth.ts 存在）时为官方
   * credentialStoreFrom/authContextFrom；其余形态为内联等价实现
   * （auth-inline.ts，与官方同语义：记录作用域 llm-pi-ai + recordKeyFor）。
   */
  auth: AuthHelpers
  /** 附件引用 → 当前模型工具执行世界的只读路径桥（官方 dsh-llm 导出）。 */
  resolveImageAttachmentAccess: typeof DshLlm.resolveImageAttachmentAccess
  /** deepseek 文件通道路由所需模块；同源自检失败时为 undefined（见 diagnostics）。 */
  deepseek?: DeepSeekKit
}

/** kit 必备形状清单：缺失即视为上游不兼容。 */
function assertKitShape(kit: DshKit, origin: string): void {
  const problems: string[] = []
  if (typeof kit.PiAiAdapter !== 'function') problems.push('PiAiAdapter 不是类')
  else {
    // 0.1.2-alpha.1 的 LlmAdapter 抽象面：prepareCall/providerRetryPolicy 为
    // master 适配器必需 override；models.getModels/getModel 语义未变
    // （pi-ai 0.84.2 Models.getModel(provider,id)/getModels(provider)，
    // 由同源 adapter 内部消费，本插件不直调）。
    for (const method of [
      'current',
      'stream',
      'listModels',
      'resolveModel',
      'providerInfo',
      'prepareCall',
      'providerRetryPolicy',
    ] as const) {
      if (typeof (kit.PiAiAdapter.prototype as Record<string, unknown>)[method] !== 'function') {
        problems.push(`PiAiAdapter.prototype.${method} 缺失`)
      }
    }
  }
  if (typeof kit.createProvider !== 'function') problems.push('pi-ai createProvider 缺失')
  if (typeof kit.getBuiltinModels !== 'function') problems.push('pi-ai getBuiltinModels 缺失')
  if (typeof kit.builtinProviders !== 'function') problems.push('pi-ai builtinProviders 缺失')
  for (const [api, factory] of Object.entries(kit.protocolFactories)) {
    if (typeof factory !== 'function') problems.push(`协议工厂 ${api} 缺失`)
  }
  if (typeof kit.LlmError !== 'function') problems.push('dsh-llm LlmError 缺失')
  if (typeof kit.resolveRetryPolicy !== 'function') problems.push('dsh-llm resolveRetryPolicy 缺失')
  if (typeof kit.resolveProfiles !== 'function') problems.push('resolveProfiles 缺失')
  if (typeof kit.resolveImageAttachmentAccess !== 'function') {
    problems.push('resolveImageAttachmentAccess 缺失')
  }
  if (
    typeof kit.auth?.credentialStoreFrom !== 'function' ||
    typeof kit.auth?.authContextFrom !== 'function'
  ) {
    problems.push('auth 助手（credentialStoreFrom/authContextFrom）缺失')
  }
  if (problems.length > 0) {
    throw new Error(`llm-pi: ${origin} 来源的运行时套件形状不兼容：${problems.join('；')}`)
  }
}

/** deepseek 模块形状自检；返回问题清单（空 = 可用），由调用方决定降级。 */
function checkDeepseekShape(kit: DeepSeekKit): string[] {
  const problems: string[] = []
  if (typeof kit.DeepSeekAdapter !== 'function') problems.push('DeepSeekAdapter 不是类')
  else if (
    typeof (kit.DeepSeekAdapter.prototype as Record<string, unknown>)['stream'] !== 'function'
  ) {
    problems.push('DeepSeekAdapter.prototype.stream 缺失')
  }
  if (typeof kit.resolveAdapterOptions !== 'function') problems.push('resolveAdapterOptions 缺失')
  if (typeof kit.getOrCreateAnonymousUserId !== 'function') {
    problems.push('getOrCreateAnonymousUserId 缺失')
  }
  return problems
}

/** 从 startDir 向上找同时含有 dsh-llm-pi-ai 与 pi-ai 的安装树根。 */
function findDshTreeRoot(startDir: string): string | undefined {
  let dir = startDir
  for (let depth = 0; depth < 8; depth += 1) {
    const nm = join(dir, 'node_modules')
    if (
      existsSync(join(nm, '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js')) &&
      existsSync(join(nm, '@earendil-works', 'pi-ai', 'dist', 'index.js'))
    ) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

interface TreeModules {
  piAiAdapter: Record<string, unknown>
  llm: Record<string, unknown>
  piAi: Record<string, unknown>
  catalog: Record<string, unknown>
  completions: Record<string, unknown>
  responses: Record<string, unknown>
  anthropic: Record<string, unknown>
}

/** 从 dsh 安装树按文件路径动态 import 全部套件模块（与官方插件同实例）。 */
async function importTreeModules(root: string): Promise<TreeModules> {
  const nm = join(root, 'node_modules')
  const load = (absPath: string): Promise<Record<string, unknown>> =>
    import(pathToFileURL(absPath).href) as Promise<Record<string, unknown>>
  const [piAiAdapter, llm, piAi, catalog, completions, responses, anthropic] = await Promise.all([
    load(join(nm, '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js')),
    load(join(nm, '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')),
    load(join(nm, '@earendil-works', 'pi-ai', 'dist', 'index.js')),
    load(join(nm, '@earendil-works', 'pi-ai', 'dist', 'providers', 'all.js')),
    load(join(nm, '@earendil-works', 'pi-ai', 'dist', 'api', 'openai-completions.lazy.js')),
    load(join(nm, '@earendil-works', 'pi-ai', 'dist', 'api', 'openai-responses.lazy.js')),
    load(join(nm, '@earendil-works', 'pi-ai', 'dist', 'api', 'anthropic-messages.lazy.js')),
  ])
  return { piAiAdapter, llm, piAi, catalog, completions, responses, anthropic }
}

/**
 * 探测包目录下的子路径模块：src/<name>.ts（dsh 树 dev 布局 / 源码仓库）→
 * src/<name>.js → lib/<name>.js（未来构建形态）。加载失败（依赖缺失等）
 * 视为该候选不可用，继续下一候选；全部未命中返回 undefined（调用方兜底）。
 */
async function probeSubmodule(
  pkgDir: string,
  name: string,
): Promise<Record<string, unknown> | undefined> {
  for (const candidate of [`src/${name}.ts`, `src/${name}.js`, `lib/${name}.js`]) {
    const absPath = join(pkgDir, candidate)
    if (!existsSync(absPath)) continue
    try {
      return (await import(pathToFileURL(absPath).href)) as Record<string, unknown>
    } catch {
      // 候选存在但不可加载：尝试下一候选
    }
  }
  return undefined
}

/** 从同一 dsh 安装树加载 deepseek 适配器模块（失败返回 undefined，不拖垮核心套件）。 */
async function importTreeDeepseek(root: string): Promise<{ kit?: DeepSeekKit; problem?: string }> {
  const nm = join(root, 'node_modules')
  const load = (absPath: string): Promise<Record<string, unknown>> =>
    import(pathToFileURL(absPath).href) as Promise<Record<string, unknown>>
  try {
    const [deepseek, anonId] = await Promise.all([
      load(join(nm, '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js')),
      load(join(nm, '@deepseek-ai', 'dsh-anonymous-user-id', 'lib', 'index.js')),
    ])
    const kit: DeepSeekKit = {
      DeepSeekAdapter: deepseek['DeepSeekAdapter'] as DeepSeekKit['DeepSeekAdapter'],
      resolveAdapterOptions: deepseek[
        'resolveAdapterOptions'
      ] as DeepSeekKit['resolveAdapterOptions'],
      getOrCreateAnonymousUserId: anonId[
        'getOrCreateAnonymousUserId'
      ] as DeepSeekKit['getOrCreateAnonymousUserId'],
    }
    const problems = checkDeepseekShape(kit)
    if (problems.length > 0) return { problem: `形状不兼容：${problems.join('；')}` }
    return { kit }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
}

function protocolFactoriesOf(mods: TreeModules): DshKit['protocolFactories'] {
  return {
    'openai-completions': mods.completions['openAICompletionsApi'] as () => unknown,
    'openai-responses': mods.responses['openAIResponsesApi'] as () => unknown,
    'anthropic-messages': mods.anthropic['anthropicMessagesApi'] as () => unknown,
  }
}

/** 插件等价解析链的套件依赖（与 PiAiAdapter 同源，杜绝跨源混用）。 */
function treeResolverDeps(
  mods: TreeModules,
  protocolFactories: DshKit['protocolFactories'],
): ResolverDeps {
  return {
    createProvider: mods.piAi['createProvider'] as DshKit['createProvider'],
    protocolFactories,
    resolveRetryPolicy: mods.llm['resolveRetryPolicy'] as DshKit['resolveRetryPolicy'],
  }
}

function kitFromTree(
  mods: TreeModules,
  auth: Record<string, unknown> | undefined,
  config: Record<string, unknown> | undefined,
): DshKit {
  const protocolFactories = protocolFactoriesOf(mods)
  const resolverDeps = treeResolverDeps(mods, protocolFactories)
  const officialResolveProfiles = config?.['resolveProfiles']
  const officialCredentialStoreFrom = auth?.['credentialStoreFrom']
  const officialAuthContextFrom = auth?.['authContextFrom']
  const recordKeyFor = mods.piAiAdapter['recordKeyFor'] as (providerId: string) => CredentialKey
  return {
    source: 'dsh-tree',
    PiAiAdapter: mods.piAiAdapter['PiAiAdapter'] as DshKit['PiAiAdapter'],
    LlmError: mods.llm['LlmError'] as DshKit['LlmError'],
    resolveRetryPolicy: mods.llm['resolveRetryPolicy'] as DshKit['resolveRetryPolicy'],
    attributionHeaders: mods.llm['attributionHeaders'] as DshKit['attributionHeaders'],
    normalizeApiKey: mods.llm['normalizeApiKey'] as DshKit['normalizeApiKey'],
    assertUsableApiKey: mods.llm['assertUsableApiKey'] as DshKit['assertUsableApiKey'],
    INVALID_CREDENTIAL_CODE: mods.llm['INVALID_CREDENTIAL_CODE'] as string,
    createProvider: mods.piAi['createProvider'] as DshKit['createProvider'],
    builtinProviders: mods.catalog['builtinProviders'] as DshKit['builtinProviders'],
    getBuiltinProviders: mods.catalog['getBuiltinProviders'] as DshKit['getBuiltinProviders'],
    getBuiltinModels: mods.catalog['getBuiltinModels'] as DshKit['getBuiltinModels'],
    protocolFactories,
    resolveProfiles:
      officialResolveProfiles !== undefined
        ? (officialResolveProfiles as ResolveProfiles)
        : (providers) => resolveProfilesFallback(providers, resolverDeps),
    auth: {
      credentialStoreFrom:
        officialCredentialStoreFrom !== undefined
          ? (officialCredentialStoreFrom as AuthHelpers['credentialStoreFrom'])
          : (ctx) => inlineCredentialStoreFrom(ctx, recordKeyFor as never),
      authContextFrom:
        officialAuthContextFrom !== undefined
          ? (officialAuthContextFrom as AuthHelpers['authContextFrom'])
          : inlineAuthContextFrom,
    },
    resolveImageAttachmentAccess: mods.llm[
      'resolveImageAttachmentAccess'
    ] as DshKit['resolveImageAttachmentAccess'],
  }
}

/** vendored 兜底副本的 deepseek 模块（形状自检不过时返回 undefined）。 */
function loadVendoredDeepseek(): DeepSeekKit | undefined {
  const kit: DeepSeekKit = {
    DeepSeekAdapter: vendoredDeepseek.DeepSeekAdapter,
    resolveAdapterOptions: vendoredDeepseek.resolveAdapterOptions,
    getOrCreateAnonymousUserId: vendoredAnonId.getOrCreateAnonymousUserId,
  }
  return checkDeepseekShape(kit).length === 0 ? kit : undefined
}

/**
 * vendored 兜底副本套件（导出供单测直接使用，免走 dsh 树解析）。
 * npm 发布形态不携带 src/、lib 仅 index.js/invariant.js——resolveProfiles 与
 * auth 助手在此无条件走插件等价实现（内联/门控表对齐，见文件头说明）。
 */
export function loadVendoredKit(): DshKit {
  const deepseek = loadVendoredDeepseek()
  const protocolFactories = {
    'openai-completions': vendoredCompletions,
    'openai-responses': vendoredResponses,
    'anthropic-messages': vendoredAnthropic,
  }
  const kit: DshKit = {
    source: 'vendored',
    PiAiAdapter: vendoredPiAiAdapter.PiAiAdapter,
    LlmError: vendoredLlm.LlmError,
    resolveRetryPolicy: vendoredLlm.resolveRetryPolicy,
    attributionHeaders: vendoredLlm.attributionHeaders,
    normalizeApiKey: vendoredLlm.normalizeApiKey,
    assertUsableApiKey: vendoredLlm.assertUsableApiKey,
    INVALID_CREDENTIAL_CODE: vendoredLlm.INVALID_CREDENTIAL_CODE,
    createProvider: vendoredPiAi.createProvider,
    builtinProviders: vendoredCatalog.builtinProviders,
    getBuiltinProviders: vendoredCatalog.getBuiltinProviders,
    getBuiltinModels: vendoredCatalog.getBuiltinModels,
    protocolFactories,
    resolveProfiles: (providers) =>
      resolveProfilesFallback(providers, {
        createProvider: vendoredPiAi.createProvider,
        protocolFactories,
        resolveRetryPolicy: vendoredLlm.resolveRetryPolicy,
      }),
    auth: {
      credentialStoreFrom: (ctx) =>
        inlineCredentialStoreFrom(ctx, vendoredPiAiAdapter.recordKeyFor),
      authContextFrom: inlineAuthContextFrom,
    },
    resolveImageAttachmentAccess: vendoredLlm.resolveImageAttachmentAccess,
    ...(deepseek === undefined ? {} : { deepseek }),
  }
  assertKitShape(kit, 'vendored')
  return kit
}

/** 定位 dsh 安装树根：realpath(argv[1]) 向上查找；argv 异常时返回 undefined。 */
function dshTreeAnchor(): string | undefined {
  const entry = process.argv[1]
  if (entry === undefined) return undefined
  try {
    return findDshTreeRoot(dirname(realpathSync(entry)))
  } catch {
    return undefined
  }
}

/**
 * 解析运行时套件：优先 dsh 安装树（自动跟随上游），失败回退 vendored 副本；
 * 两者都过不了形状自检时抛错（调用方应记日志并放弃注册 route）。
 * 返回的 diagnostics 记录回退原因，供配置卡片与日志展示。
 */
export async function resolveDshKit(): Promise<{
  kit: DshKit
  diagnostics: string[]
}> {
  const diagnostics: string[] = []
  const anchor = dshTreeAnchor()
  if (anchor !== undefined) {
    const treePkgDir = join(anchor, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai')
    try {
      const mods = await importTreeModules(anchor)
      const [auth, config] = await Promise.all([
        probeSubmodule(treePkgDir, 'auth'),
        probeSubmodule(treePkgDir, 'config'),
      ])
      const kit = kitFromTree(mods, auth, config)
      assertKitShape(kit, 'dsh-tree')
      if (auth === undefined) {
        diagnostics.push(
          'dsh 树不含 dsh-llm-pi-ai/src（npm 发布形态）；认证助手使用插件内联等价实现',
        )
      }
      if (config === undefined) {
        diagnostics.push(
          'dsh 树不含 dsh-llm-pi-ai/src（npm 发布形态）；profile 解析使用插件等价实现（compat 门控对齐官方 catalog.ts）',
        )
      }
      const tree = await importTreeDeepseek(anchor)
      if (tree.kit !== undefined) {
        return { kit: { ...kit, deepseek: tree.kit }, diagnostics }
      }
      diagnostics.push(
        `dsh 安装树的 dsh-llm-deepseek 不可用（${tree.problem ?? '未知原因'}）；` +
          'adapter: deepseek 的 route 不可用，pi 路由不受影响',
      )
      return { kit, diagnostics }
    } catch (error) {
      diagnostics.push(
        `dsh 安装树套件不可用（${anchor}）：${error instanceof Error ? error.message : String(error)}；回退 vendored 副本`,
      )
    }
  } else {
    diagnostics.push('未能从 process.argv[1] 定位 dsh 安装树；回退 vendored 副本')
  }
  const kit = loadVendoredKit()
  if (kit.deepseek === undefined) {
    diagnostics.push(
      'vendored 副本的 dsh-llm-deepseek 形状不兼容；adapter: deepseek 的 route 不可用',
    )
  }
  return { kit, diagnostics }
}
