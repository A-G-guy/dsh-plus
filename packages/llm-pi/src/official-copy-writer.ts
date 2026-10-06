/**
 * 官方应急副本的生成编排：装配（原始配置 → 物化 → 翻译）→ 逐 route 官方校验
 * → 备忘跳过 / 原子落盘 → 状态供配置卡与 lifeboat 面板消费。
 *
 * 触发时机：插件启动、配置热更新（loader/volatile-update）、adapter 注册变化
 * （llm/adapters-updated，官方 llm-pi-ai 晚注册时手写条目在此补入）。无定时器、
 * 无 watcher——平时零开销；写失败只降级为状态与日志，绝不影响路由注册。
 *
 * 逐 route 官方校验是「副本必然官方可识别」的执行点：官方 Config schema 解析
 * （非法协议/越界取值在此抛错）+ 官方 resolveProfiles 可服务性链；任一不过即
 * 剔除该 route 并记 warning——写不进官方的东西绝不落盘。
 * @module llm-pi/official-copy-writer
 */
import { stat } from 'node:fs/promises'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { atomicWriteFile, isVolatileRef } from '@dsh-plus/shared'

import type { LlmPiConfig } from './config.ts'
import {
  buildOfficialCopy,
  deriveOfficialRouteFields,
  FALLBACK_ROUTE_FIELDS,
  OFFICIAL_COPY_PATH,
  type OfficialCopy,
  renderOfficialCopy,
} from './official-copy.ts'
import { normalizeOfficialRoutes } from './profiles.ts'
import { buildDeepseekRoutes } from './profiles-deepseek.ts'
import type { DshKit } from './resolve-dsh.ts'

/** 官方 llm-pi-ai 的 settings 命名空间（与插件 NS 同字面量，官方 0.1.x 起稳定）。 */
const NS_OFFICIAL_PI_AI = 'llm-pi-ai'

/** 副本状态（配置卡状态行与诊断的 JSON 面；updatedAt 缺省 = 尚未生成）。 */
export interface OfficialCopyStatus {
  path: string
  updatedAt?: number
  routes: number
  warnings: string[]
  error?: string
}

/** 手写官方条目读取结果：providers 缺省 + warning 说明降级原因。 */
export interface ManualSourceResult {
  providers?: Record<string, unknown>
  warning?: string
}

/** settings 服务窄面（describe 的描述符子集；测试可注入固定值）。 */
export interface SettingsDescribeLike {
  describe(): Array<{ ns: string; value?: unknown }>
}

/**
 * 手写官方条目来源：settings describe 的 llm-pi-ai 生效视图（composition base
 * = profile patch 行 + settings 用户层，schema 已解析、已过官方 validate）——
 * 官方 seam，无需自行解析 patch 文件。ns 未注册/读取失败时降级为「仅本插件
 * 改写条目」并附 warning，不阻断生成。
 */
export function readManualProviders(settings: SettingsDescribeLike): ManualSourceResult {
  try {
    const row = settings.describe().find((entry) => entry.ns === NS_OFFICIAL_PI_AI)
    if (row === undefined) {
      return { warning: '官方 llm-pi-ai 未注册（插件缺席），副本仅含本插件改写条目' }
    }
    const raw = (row.value as { providers?: unknown } | undefined)?.providers
    const providers = isVolatileRef(raw) ? raw.get() : raw
    if (providers === null || typeof providers !== 'object') return {}
    return { providers: providers as Record<string, unknown> }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { warning: `读取官方 llm-pi-ai 生效配置失败（${message}），副本仅含本插件改写条目` }
  }
}

export interface OfficialCopyWriterDeps {
  kit: DshKit
  /** 当前生效的本插件配置（volatile 已解包的平面快照）。 */
  current: () => LlmPiConfig
  /** 手写官方条目读取（生产接 readManualProviders(ctx.settings)）。 */
  readManual: () => ManualSourceResult
  /** 来源 profile 名（头注释应用指引用）。 */
  profile: string | undefined
  /** 落盘路径（缺省 .dsh 根的 OFFICIAL_COPY_PATH；测试注入临时路径）。 */
  path?: string
  logger: { warn(message: unknown): void }
}

export interface OfficialCopyWriter {
  /** 生成（或确认最新）副本：串行化执行，失败降级为状态，绝不抛出。 */
  ensureOfficialCopy(): Promise<void>
  /** 最近一次生成的状态。 */
  status(): OfficialCopyStatus
}

/** 文件是否已存在（内容备忘跳过后自愈外部删除）。 */
async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** 组装 + 翻译：返回含全部 warning 的副本内容（尚未官方校验）。 */
function assemble(deps: OfficialCopyWriterDeps, warnings: string[]): OfficialCopy {
  const routeFields = deriveOfficialRouteFields(deps.kit.officialConfig)
  if (routeFields === undefined) {
    warnings.push('官方 Config schema 布局不可识别，route 字段回退内置键集')
  }
  const providers = deps.current().providers ?? {}
  const normalizedPi = normalizeOfficialRoutes(providers, {
    kit: deps.kit,
    lenient: true,
    warn: (message) => warnings.push(message),
  })
  const deepseekResolved = buildDeepseekRoutes(providers, {
    kit: deps.kit,
    lenient: true,
    warn: (message) => warnings.push(message),
  })
  const manual = deps.readManual()
  if (manual.warning !== undefined) warnings.push(manual.warning)
  const copy = buildOfficialCopy({
    providers,
    normalizedPi,
    deepseekResolved,
    manualProviders: manual.providers,
    routeFields: routeFields ?? [...FALLBACK_ROUTE_FIELDS],
    modelFields: deps.kit.officialModelFields,
  })
  warnings.push(...copy.warnings)
  return { providers: copy.providers, warnings }
}

/** 逐 route 官方校验：schema 解析 + 可服务性链；不过即剔除并记 warning。 */
function acceptOfficial(
  deps: OfficialCopyWriterDeps,
  copy: OfficialCopy,
  warnings: string[],
): Record<string, unknown> {
  const accepted: Record<string, unknown> = {}
  for (const [route, profile] of Object.entries(copy.providers)) {
    try {
      deps.kit.officialConfig({ providers: { [route]: profile } })
      deps.kit.resolveProfiles({ [route]: profile as PiAiProviderProfile })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`route "${route}" 未通过官方校验，已从副本剔除：${message}`)
      continue
    }
    accepted[route] = profile
  }
  return accepted
}

/** 生成态：内容备忘（跳过同内容重写）与最近生成时间（mtime 语义）。 */
interface CopyState {
  lastContent?: string
  updatedAt?: number
}

/** 落盘：内容未变且文件仍在则跳过（并自愈外部删除）；返回最近生成时间。 */
async function persist(path: string, content: string, state: CopyState): Promise<number> {
  if (content === state.lastContent && (await fileExists(path)))
    return state.updatedAt ?? Date.now()
  await atomicWriteFile(path, content)
  state.lastContent = content
  state.updatedAt = Date.now()
  return state.updatedAt
}

/** 生成一次副本（错误上抛，由调用方降级为 status.error）。 */
async function runOnce(
  deps: OfficialCopyWriterDeps,
  path: string,
  state: CopyState,
): Promise<OfficialCopyStatus> {
  const warnings: string[] = []
  const assembled = assemble(deps, warnings)
  const providers = acceptOfficial(deps, assembled, warnings)
  const content = renderOfficialCopy({ providers, warnings }, { profile: deps.profile })
  const updatedAt = await persist(path, content, state)
  return { path, updatedAt, routes: Object.keys(providers).length, warnings }
}

/** 装配写入器：启动/热更新/adapter 事件驱动，串行执行（promise 链）。 */
export function createOfficialCopyWriter(deps: OfficialCopyWriterDeps): OfficialCopyWriter {
  const path = deps.path ?? OFFICIAL_COPY_PATH
  const state: CopyState = {}
  let status: OfficialCopyStatus = { path, routes: 0, warnings: [] }
  let chain: Promise<void> = Promise.resolve()
  const ensureOfficialCopy = (): Promise<void> => {
    chain = chain.then(async () => {
      try {
        status = await runOnce(deps, path, state)
      } catch (error) {
        // 落盘/装配失败：磁盘上仍是上一次成功的副本，保留其状态并标注错误。
        const message = error instanceof Error ? error.message : String(error)
        deps.logger.warn(`llm-pi: 应急副本生成失败：${message}`)
        status = { ...status, error: message }
      }
    })
    return chain
  }
  return { ensureOfficialCopy, status: () => status }
}
