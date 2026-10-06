/**
 * dsh 运行时套件解析：让插件跑在 dsh 当前安装树的同一份
 * dsh-llm-pi-ai / dsh-llm / pi-ai 之上，从而 dsh 升级即自动跟随上游。
 *
 * 解析策略（全部模块同源地整体成功或整体回退，杜绝跨源混用）：
 * 1. dsh-tree：锚点链 = profileContext.installAnchor（CLI/桌面端同一事实，
 *    桌面端 Electron 下 argv[1] 探测走不通）→ realpath(argv[1]) 向上找到同时
 *    含 node_modules/@deepseek-ai/dsh-llm-pi-ai 与 node_modules/@earendil-works/pi-ai
 *    的目录，按文件路径动态 import——与 dsh 官方插件共享同一模块实例；
 * 2. vendored：回退到本插件 devDependencies 里的副本（裸 import）。
 *
 * 两条路径产物都过形状自检（assertKitShape）：上游重构导致形状漂移时抛错，
 * 由调用方决定回退或放弃注册——绝不让坏套件进入消息链路。
 *
 * **自动跟随（版本不参与分支）**：插件不认识"某个 pi-ai 版本"，只认识形状与
 * 现场推导出的适配面。协议集合取自已装官方包的 `supportedProtocols()`，每个协议
 * 的惰性工厂按 `pi-ai/dist/api/<api>.lazy.js`（api id 即模块名，pi-ai 包导出约定）
 * 动态加载；缺失的协议逐项跳过并记诊断，其余协议照常。compat 门控/取值约束与
 * 模型条目字段集同样现场推导（official-surface.ts）。生效版本只用于状态行显示，
 * 超出已验证区间也只是提示（kit-meta.ts），永不阻断。
 *
 * 仅 src 子路径导出、包根不导出的两块面：
 * - resolveProfiles（config.ts）：官方解析链，dev 布局树可经 src 子路径复用；
 * - credentialStoreFrom/authContextFrom（auth.ts）：PiAiAdapter 必需 auth 注入。
 * npm 发布形态（lib/index.js 单 bundle + 无 src/）两者都拿不到：dsh 树优先
 * 探测 src/*（含 lib/* 候选），未命中时 resolveProfiles 走插件等价实现
 * （profiles.ts，门控表对齐官方 catalog.ts）、auth 走内联等价实现
 * （auth-inline.ts，recordKeyFor 自包根导出同源注入）——形状自检兜底。
 * @module llm-pi/resolve-dsh
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { getOrCreateAnonymousUserId as getAnonIdType } from '@deepseek-ai/dsh-anonymous-user-id'
import * as vendoredAnonId from '@deepseek-ai/dsh-anonymous-user-id'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type * as DshLlm from '@deepseek-ai/dsh-llm'
import * as vendoredLlm from '@deepseek-ai/dsh-llm'
import type {
  catalogModelInfo as catalogModelInfoType,
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
import { installCompatTable } from './compat.ts'
import { collectTreeVersions, collectVendoredVersions, type KitVersions } from './kit-meta.ts'
import {
  deriveGates,
  deriveModelEntryFields,
  deriveProtocols,
  deriveSpecs,
  FALLBACK_MODEL_ENTRY_FIELDS,
  FALLBACK_TABLE,
  fallbackProtocols,
} from './official-surface.ts'
import { type ResolverDeps, resolveProfilesFallback } from './profiles.ts'

/**
 * deepseek 适配器模块表面（可选）：dsh-llm-deepseek 的官方 DeepSeekAdapter
 * 与目录解析器 + 匿名用户 id。缺失（形状漂移）不拖垮核心
 * 套件——deepseek 类 route 在构建期以明确错误拒绝，pi 路由不受影响。
 * 与核心套件强制同源（杜绝跨源模块混用：brand/LlmError 恒等性敏感）。
 */
export interface DeepSeekKit {
  DeepSeekAdapter: typeof DeepSeekAdapterType
  resolveAdapterOptions: typeof resolveDeepSeekOptionsType
  getOrCreateAnonymousUserId: typeof getAnonIdType
  /** 目录项 → LlmModelInfo（0.2.0 起 listModels 经 discoverModels 消费）。 */
  catalogModelInfo: typeof catalogModelInfoType
}

/** profile 解析面（官方 config.ts resolveProfiles 的签名；包根未导出，见文件头）。 */
export type ResolveProfiles = (
  providers: Readonly<Record<string, PiAiProviderProfile>> | undefined,
) => Map<string, ResolvedPiAiProviderProfile>

/**
 * 官方 Config schema 的调用面（根导出 `Config`，schemastery schema 的可调用形态）：
 * 应急副本写前校验「官方是否接受这个形状」——非法协议/取值越界在此抛错。
 * 只用其抛错语义，解析产物（volatile 视图）不消费。
 */
export type OfficialConfigSchema = (value: unknown) => unknown

/** PiAiAdapter 必需 auth 注入的两个助手（官方 auth.ts 面；包根未导出）。 */
export interface AuthHelpers {
  credentialStoreFrom(ctx: Context): CredentialStore
  authContextFrom(ctx: Context): AuthContext
}

/** 插件运行期所需的全部上游模块表面（单一来源，内部一致）。 */
export interface DshKit {
  /** 解析来源：dsh 安装树 / 插件 vendored 兜底副本。 */
  source: 'dsh-tree' | 'vendored'
  /** 套件所在根（dsh 安装树根 / vendored 包所在 node_modules 的父目录），诊断用。 */
  root?: string
  /** 实际生效版本（状态行显示；不参与任何分支判断）。 */
  versions: KitVersions
  /** 当前可服务的线协议（顺序即官方表顺序；无工厂的协议已被剔除）。 */
  protocols: string[]
  /** 协议集合来源：official = 官方 supportedProtocols()；fallback = 内置三元组。 */
  protocolSource: 'official' | 'fallback'
  protocolFactories: Record<string, () => unknown>
  /** 官方 Config schema 接受的模型条目键集（继承透传白名单，现场推导）。 */
  officialModelFields: string[]
  /** 内置目录数据生成时间（毫秒）；官方未导出该信息时省略。 */
  catalogGeneratedAt?: number
  PiAiAdapter: typeof PiAiAdapterType
  /**
   * 官方 `Config` schema（与 PiAiAdapter 同一模块根导出，同源取用）：
   * 应急副本落盘前的官方可识别性校验（见 {@link OfficialConfigSchema}）。
   */
  officialConfig: OfficialConfigSchema
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
    // LlmAdapter 抽象面：prepareCall/providerRetryPolicy 为适配器必需 override；
    // models.getModels/getModel 语义
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
      // 原型方法存在性自检：类实例的原型在运行期是普通对象，按方法名索引读取安全
      // （类类型本身无索引签名，故经 unknown 转字典视图；形状由本函数逐项断言）。
      if (
        typeof (kit.PiAiAdapter.prototype as unknown as Record<string, unknown>)[method] !==
        'function'
      ) {
        problems.push(`PiAiAdapter.prototype.${method} 缺失`)
      }
    }
  }
  if (typeof kit.createProvider !== 'function') problems.push('pi-ai createProvider 缺失')
  if (typeof kit.officialConfig !== 'function') problems.push('dsh-llm-pi-ai Config schema 缺失')
  if (typeof kit.getBuiltinModels !== 'function') problems.push('pi-ai getBuiltinModels 缺失')
  if (typeof kit.builtinProviders !== 'function') problems.push('pi-ai builtinProviders 缺失')
  if (kit.protocols.length === 0) problems.push('没有可服务的线协议（协议工厂全部加载失败）')
  for (const api of kit.protocols) {
    if (typeof kit.protocolFactories[api] !== 'function') {
      problems.push(`协议 ${api} 的工厂缺失`)
    }
  }
  if (kit.officialModelFields.length === 0) problems.push('官方模型条目字段集为空')
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
    // 同 assertKitShape：原型方法存在性自检，经 unknown 转字典视图读取。
    typeof (kit.DeepSeekAdapter.prototype as unknown as Record<string, unknown>)['stream'] !==
    'function'
  ) {
    problems.push('DeepSeekAdapter.prototype.stream 缺失')
  }
  if (typeof kit.resolveAdapterOptions !== 'function') problems.push('resolveAdapterOptions 缺失')
  if (typeof kit.catalogModelInfo !== 'function') problems.push('catalogModelInfo 缺失')
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

/** dsh 树内与官方插件同源加载的核心模块（协议工厂按推导结果另加载）。 */
interface TreeModules {
  piAiAdapter: Record<string, unknown>
  llm: Record<string, unknown>
  piAi: Record<string, unknown>
  catalog: Record<string, unknown>
}

/** 从 dsh 安装树按文件路径动态 import 核心套件模块（与官方插件同实例）。 */
async function importTreeModules(root: string): Promise<TreeModules> {
  const nm = join(root, 'node_modules')
  const load = (absPath: string): Promise<Record<string, unknown>> =>
    import(pathToFileURL(absPath).href) as Promise<Record<string, unknown>>
  const [piAiAdapter, llm, piAi, catalog] = await Promise.all([
    load(join(nm, '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js')),
    load(join(nm, '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')),
    load(join(nm, '@earendil-works', 'pi-ai', 'dist', 'index.js')),
    load(join(nm, '@earendil-works', 'pi-ai', 'dist', 'providers', 'all.js')),
  ])
  return { piAiAdapter, llm, piAi, catalog }
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
      catalogModelInfo: deepseek['catalogModelInfo'] as DeepSeekKit['catalogModelInfo'],
    }
    const problems = checkDeepseekShape(kit)
    if (problems.length > 0) return { problem: `形状不兼容：${problems.join('；')}` }
    return { kit }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 取惰性协议模块里的工厂：约定每个 `api/<api>.lazy.js` 只导出一个 `*Api`
 * 工厂函数。名字不符时退化为"唯一函数导出"，多函数且无 `*Api` 命名则判失败
 * （宁可跳过该协议，也不猜错工厂）。
 */
function protocolFactoryOf(module: Record<string, unknown>): (() => unknown) | undefined {
  const functions = Object.entries(module).filter(
    (entry): entry is [string, () => unknown] => typeof entry[1] === 'function',
  )
  const named = functions.filter(([name]) => /Api$/.test(name))
  if (named.length === 1) return named[0]?.[1]
  if (functions.length === 1) return functions[0]?.[1]
  return undefined
}

/** pi-ai 的惰性协议实现目录（dsh 树布局）。 */
function piAiApiDir(root: string): string {
  return join(root, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'api')
}

/** 内置三元组的静态加载（协议推导失败或全部工厂加载失败时的兜底）。 */
async function loadFallbackTreeFactories(
  root: string,
  diagnostics: string[],
): Promise<Record<string, () => unknown>> {
  const dir = piAiApiDir(root)
  const out: Record<string, () => unknown> = {}
  for (const api of fallbackProtocols()) {
    const file = join(dir, `${api}.lazy.js`)
    if (!existsSync(file)) continue
    try {
      const factory = protocolFactoryOf((await import(pathToFileURL(file).href)) as never)
      if (factory !== undefined) out[api] = factory
    } catch {
      // 单个兜底协议加载失败：静默留给 assertKitShape 汇总（下方诊断已说明回退）
    }
  }
  if (Object.keys(out).length < fallbackProtocols().length) {
    diagnostics.push(
      `pi-ai 协议兜底三元组未能全部加载（${Object.keys(out).join('/') || '空'}）；` +
        '请检查 dsh 安装树里 @earendil-works/pi-ai/dist/api 的形态',
    )
  }
  return out
}

/**
 * 按官方声明的协议集合加载 pi-ai 惰性工厂（api id 即模块名）。
 * 逐项失败只跳过该协议并记诊断；一个都加载不到时回退内置三元组。
 */
async function loadTreeProtocols(
  root: string,
  derived: string[],
  diagnostics: string[],
): Promise<{ protocols: string[]; protocolFactories: Record<string, () => unknown> }> {
  const dir = piAiApiDir(root)
  const out: Record<string, () => unknown> = {}
  for (const api of derived) {
    const file = join(dir, `${api}.lazy.js`)
    if (!existsSync(file)) {
      diagnostics.push(
        `pi-ai 未提供协议 "${api}" 的惰性实现（缺 ${file}）；该协议不可用，其余协议不受影响`,
      )
      continue
    }
    try {
      const factory = protocolFactoryOf((await import(pathToFileURL(file).href)) as never)
      if (factory === undefined) {
        diagnostics.push(`协议 "${api}" 的实现模块未导出唯一 *Api 工厂；该协议不可用`)
        continue
      }
      out[api] = factory
    } catch (error) {
      diagnostics.push(
        `协议 "${api}" 的实现加载失败（${error instanceof Error ? error.message : String(error)}）；该协议不可用`,
      )
    }
  }
  if (Object.keys(out).length > 0) {
    return { protocols: derived.filter((api) => out[api] !== undefined), protocolFactories: out }
  }
  diagnostics.push('官方声明的协议一个都加载不到；回退内置三元组')
  const fallback = await loadFallbackTreeFactories(root, diagnostics)
  return {
    protocols: fallbackProtocols().filter((api) => fallback[api] !== undefined),
    protocolFactories: fallback,
  }
}

function protocolFactoriesOf(
  protocols: string[],
  factories: Record<string, () => unknown>,
): DshKit['protocolFactories'] {
  const out: DshKit['protocolFactories'] = {}
  for (const api of protocols) {
    const factory = factories[api]
    if (factory !== undefined) out[api] = factory
  }
  return out
}

/** 插件等价解析链的套件依赖（与 PiAiAdapter 同源，杜绝跨源混用）。 */
function treeResolverDeps(
  mods: TreeModules,
  protocolFactories: DshKit['protocolFactories'],
  protocols: string[],
): ResolverDeps {
  return {
    createProvider: mods.piAi['createProvider'] as DshKit['createProvider'],
    protocolFactories,
    protocols,
    resolveRetryPolicy: mods.llm['resolveRetryPolicy'] as DshKit['resolveRetryPolicy'],
  }
}

/** 官方适配面推导结果（协议/模型字段/compat 表/compat 来源）。 */
interface OfficialSurface {
  protocols: string[]
  protocolSource: 'official' | 'fallback'
  officialModelFields: string[]
  catalogGeneratedAt?: number
}

/** 读内置目录数据生成时间（官方未导出/形状变化时省略）。 */
function catalogGeneratedAtOf(catalog: Record<string, unknown>): number | undefined {
  const reader = catalog['getBuiltinModelDataGeneratedAt']
  if (typeof reader !== 'function') return undefined
  try {
    const value = (reader as () => unknown)()
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * 从官方安装副本推导适配面并安装 compat 生效表（bundle 文本给分型、Config schema
 * 给取值约束与模型条目字段集、supportedProtocols() 给协议集合）。
 * 任一环节失败都逐项回退并记诊断——绝不因推导失败弄挂插件启动。
 */
function installOfficialSurface(options: {
  bundlePath: string
  adapterModule: Record<string, unknown>
  catalogModule: Record<string, unknown>
  origin: string
  diagnostics: string[]
}): OfficialSurface {
  const { bundlePath, adapterModule, origin, diagnostics } = options
  const compatLabel = 'compat 门控表'
  try {
    const bundle = readFileSync(bundlePath, 'utf8')
    const gates = deriveGates(bundle)
    if (gates === undefined) {
      // 官方改打包形态导致 COMPAT_GATES 不可解析：用冻结快照并告警。
      // 快照模式下未知 compat 键**放行**（交给官方自身校验），只拦快照里明确的
      // withhold——表落后时"误拒官方新字段"比"多放一个键"严重得多。
      diagnostics.push(
        `${compatLabel}未能从官方 bundle 解析 COMPAT_GATES（${bundlePath}）；` +
          `使用内置快照（未知字段放行、withhold 仍拒绝；请检查 dsh-llm-pi-ai 打包形态）`,
      )
      installCompatTable(FALLBACK_TABLE)
    } else {
      // 取值约束：推导值优先，内置快照补缺（官方 schema 未覆盖的字段保持可写）。
      const specs = { ...FALLBACK_TABLE.specs, ...deriveSpecs(adapterModule) }
      installCompatTable({ gates, specs, source: 'official' })
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    diagnostics.push(`${compatLabel}推导失败（${reason}）；使用内置快照（未知字段放行）`)
    installCompatTable(FALLBACK_TABLE)
  }

  const derivedProtocols = deriveProtocols(adapterModule)
  if (derivedProtocols === undefined) {
    diagnostics.push(
      `${origin}：官方 supportedProtocols() 不可用；协议集合回退内置三元组 ${fallbackProtocols().join('/')}`,
    )
  }
  const fields = deriveModelEntryFields(adapterModule)
  if (fields === undefined) {
    diagnostics.push(
      `${origin}：官方 Config schema 的模型条目字段集不可推导；` +
        `继承字段回退已知键 ${FALLBACK_MODEL_ENTRY_FIELDS.join('/')}（官方新增字段可能不被继承）`,
    )
  }
  const generatedAt = catalogGeneratedAtOf(options.catalogModule)
  return {
    protocols: derivedProtocols ?? fallbackProtocols(),
    protocolSource: derivedProtocols === undefined ? 'fallback' : 'official',
    officialModelFields: fields ?? [...FALLBACK_MODEL_ENTRY_FIELDS],
    ...(generatedAt === undefined ? {} : { catalogGeneratedAt: generatedAt }),
  }
}

function kitFromTree(options: {
  mods: TreeModules
  auth: Record<string, unknown> | undefined
  config: Record<string, unknown> | undefined
  surface: OfficialSurface
  protocols: string[]
  protocolFactories: DshKit['protocolFactories']
  root: string
  versions: KitVersions
}): DshKit {
  const { mods, surface, protocols, protocolFactories, root, versions } = options
  const resolverDeps = treeResolverDeps(mods, protocolFactories, protocols)
  const officialResolveProfiles = options.config?.['resolveProfiles']
  const officialCredentialStoreFrom = options.auth?.['credentialStoreFrom']
  const officialAuthContextFrom = options.auth?.['authContextFrom']
  const recordKeyFor = mods.piAiAdapter['recordKeyFor'] as (providerId: string) => CredentialKey
  return {
    source: 'dsh-tree',
    root,
    versions,
    protocols,
    protocolSource: surface.protocolSource,
    protocolFactories,
    officialModelFields: surface.officialModelFields,
    ...(surface.catalogGeneratedAt === undefined
      ? {}
      : { catalogGeneratedAt: surface.catalogGeneratedAt }),
    PiAiAdapter: mods.piAiAdapter['PiAiAdapter'] as DshKit['PiAiAdapter'],
    officialConfig: mods.piAiAdapter['Config'] as DshKit['officialConfig'],
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
    catalogModelInfo: vendoredDeepseek.catalogModelInfo,
  }
  return checkDeepseekShape(kit).length === 0 ? kit : undefined
}

/**
 * vendored `dsh-llm-pi-ai` 的 bundle 绝对路径（compat 门控推导用）。
 * 经包名解析拿到入口文件——npm/pnpm 各布局都适用，不硬编码 node_modules 结构。
 */
function vendoredAdapterBundlePath(): string {
  return fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai'))
}

/** vendored 副本的静态协议工厂表（devDependencies 钉版，故无需动态加载）。 */
function vendoredProtocolFactories(): Record<string, () => unknown> {
  return {
    'openai-completions': vendoredCompletions,
    'openai-responses': vendoredResponses,
    'anthropic-messages': vendoredAnthropic,
  }
}

/**
 * vendored 兜底副本套件（导出供单测直接使用，免走 dsh 树解析）。
 * 副本是**钉版**的，故协议工厂走静态导入，协议集合取"官方声明 ∩ 静态工厂"；
 * npm 发布形态不携带 src/、lib 仅 index.js/invariant.js——resolveProfiles 与
 * auth 助手在此无条件走插件等价实现（内联，见文件头说明）；compat 门控表则
 * 仍从 vendored 副本的 bundle + Config schema 现场推导（与 dsh 树同一推导链）。
 * @param diagnostics 可选诊断收集器（回退原因与逐项降级说明）。
 */
export function loadVendoredKit(diagnostics: string[] = []): DshKit {
  const staticFactories = vendoredProtocolFactories()
  const surface = installOfficialSurface({
    bundlePath: vendoredAdapterBundlePath(),
    adapterModule: vendoredPiAiAdapter as unknown as Record<string, unknown>,
    catalogModule: vendoredCatalog as unknown as Record<string, unknown>,
    origin: 'vendored 副本',
    diagnostics,
  })
  const protocols = surface.protocols.filter((api) => staticFactories[api] !== undefined)
  const protocolFactories = protocolFactoriesOf(protocols, staticFactories)
  const resolverDeps: ResolverDeps = {
    createProvider: vendoredPiAi.createProvider,
    protocolFactories,
    protocols,
    resolveRetryPolicy: vendoredLlm.resolveRetryPolicy,
  }
  const deepseek = loadVendoredDeepseek()
  const kit: DshKit = {
    source: 'vendored',
    versions: collectVendoredVersions(),
    protocols,
    // 官方声明里若有本副本未携带工厂的协议（副本钉版），集合仍是"官方声明"的
    // 子集，故来源标注跟随推导结果；一个都不剩时按回退处理（assertKitShape 兜底）。
    protocolSource: protocols.length > 0 ? surface.protocolSource : 'fallback',
    protocolFactories,
    officialModelFields: surface.officialModelFields,
    ...(surface.catalogGeneratedAt === undefined
      ? {}
      : { catalogGeneratedAt: surface.catalogGeneratedAt }),
    PiAiAdapter: vendoredPiAiAdapter.PiAiAdapter,
    officialConfig: vendoredPiAiAdapter.Config as DshKit['officialConfig'],
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
    resolveProfiles: (providers) => resolveProfilesFallback(providers, resolverDeps),
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

/**
 * 定位 dsh 安装树根：优先 `profileContext.installAnchor`（CLI 与桌面端同一
 * 事实——桌面端 Electron 启动时 argv[1] 是 Electron 自身、走不通 argv 探测，
 * 锚点是唯一可靠来源），其次 realpath(argv[1]) 向上查找；均失败返回 undefined。
 * argvEntry 参数仅测试注入（缺省 process.argv[1]）。
 */
export function dshTreeAnchor(
  installAnchor?: string | undefined,
  argvEntry: string | undefined = process.argv[1],
): string | undefined {
  if (installAnchor !== undefined && installAnchor.length > 0) {
    const anchored = findDshTreeRoot(dirname(installAnchor))
    if (anchored !== undefined) return anchored
  }
  if (argvEntry === undefined) return undefined
  try {
    return findDshTreeRoot(dirname(realpathSync(argvEntry)))
  } catch {
    return undefined
  }
}

/**
 * 解析运行时套件：优先 dsh 安装树（自动跟随上游），失败回退 vendored 副本；
 * 两者都过不了形状自检时抛错（调用方应记日志并放弃注册 route）。
 * 返回的 diagnostics 记录回退原因与逐项降级说明，供配置卡片与日志展示。
 * @param installAnchor profile 的 dsh 安装锚点（`ctx.profileContext.installAnchor`）。
 */
export async function resolveDshKit(installAnchor?: string | undefined): Promise<{
  kit: DshKit
  diagnostics: string[]
}> {
  const diagnostics: string[] = []
  const anchor = dshTreeAnchor(installAnchor)
  if (anchor !== undefined) {
    const treePkgDir = join(anchor, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai')
    try {
      const mods = await importTreeModules(anchor)
      const surface = installOfficialSurface({
        bundlePath: join(treePkgDir, 'lib', 'index.js'),
        adapterModule: mods.piAiAdapter,
        catalogModule: mods.catalog,
        origin: 'dsh 安装树',
        diagnostics,
      })
      const { protocols, protocolFactories } = await loadTreeProtocols(
        anchor,
        surface.protocols,
        diagnostics,
      )
      const [auth, config] = await Promise.all([
        probeSubmodule(treePkgDir, 'auth'),
        probeSubmodule(treePkgDir, 'config'),
      ])
      const kit = kitFromTree({
        mods,
        auth,
        config,
        surface,
        protocols,
        protocolFactories,
        root: anchor,
        versions: collectTreeVersions(anchor),
      })
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
    diagnostics.push(
      '未能从 profileContext.installAnchor / process.argv[1] 定位 dsh 安装树；回退 vendored 副本',
    )
  }
  const kit = loadVendoredKit(diagnostics)
  if (kit.deepseek === undefined) {
    diagnostics.push(
      'vendored 副本的 dsh-llm-deepseek 形状不兼容；adapter: deepseek 的 route 不可用',
    )
  }
  return { kit, diagnostics }
}
