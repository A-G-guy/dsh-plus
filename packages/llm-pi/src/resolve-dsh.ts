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
 * 两条路径产物都过形状自检（assertKitShape）：上游 rc 重构导致形状漂移时
 * 抛错，由调用方决定回退或放弃注册——绝不让坏套件进入消息链路。
 * @module llm-pi/resolve-dsh
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as DshLlm from '@deepseek-ai/dsh-llm'
import * as vendoredLlm from '@deepseek-ai/dsh-llm'
import type { PiAiAdapter as PiAiAdapterType } from '@deepseek-ai/dsh-llm-pi-ai'
import * as vendoredPiAiAdapter from '@deepseek-ai/dsh-llm-pi-ai'
import type * as PiAi from '@earendil-works/pi-ai'
import * as vendoredPiAi from '@earendil-works/pi-ai'
import { anthropicMessagesApi as vendoredAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi as vendoredCompletions } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi as vendoredResponses } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import * as vendoredCatalog from '@earendil-works/pi-ai/providers/all'

import type { ProtocolId } from './config.ts'

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
}

/** kit 必备形状清单：缺失即视为上游不兼容。 */
function assertKitShape(kit: DshKit, origin: string): void {
  const problems: string[] = []
  if (typeof kit.PiAiAdapter !== 'function') problems.push('PiAiAdapter 不是类')
  else {
    for (const method of [
      'current',
      'stream',
      'listModels',
      'resolveModel',
      'providerInfo',
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
  if (problems.length > 0) {
    throw new Error(`llm-pi: ${origin} 来源的运行时套件形状不兼容：${problems.join('；')}`)
  }
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

function kitFromTree(mods: TreeModules): DshKit {
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
    protocolFactories: {
      'openai-completions': mods.completions['openAICompletionsApi'] as () => unknown,
      'openai-responses': mods.responses['openAIResponsesApi'] as () => unknown,
      'anthropic-messages': mods.anthropic['anthropicMessagesApi'] as () => unknown,
    },
  }
}

/** vendored 兜底副本套件（导出供单测直接使用，免走 dsh 树解析）。 */
export function loadVendoredKit(): DshKit {
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
    protocolFactories: {
      'openai-completions': vendoredCompletions,
      'openai-responses': vendoredResponses,
      'anthropic-messages': vendoredAnthropic,
    },
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
    try {
      const kit = kitFromTree(await importTreeModules(anchor))
      assertKitShape(kit, 'dsh-tree')
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
  return { kit, diagnostics }
}
