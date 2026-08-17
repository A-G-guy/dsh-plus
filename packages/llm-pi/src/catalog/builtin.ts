/**
 * pi-ai 内置目录适配：继承解析的第一级（最高优先级）数据源。
 * 内置条目带 pi 官方校正（compat、thinkingLevelMap、能力过滤），最可信。
 * @module llm-pi/catalog/builtin
 */
import type { DshKit } from '../resolve-dsh.ts'

/**
 * 继承源可提供的模型字段（pi-ai Model 的可继承子集）。
 * 全部可选：models.dev 兜底源只给得出其中一部分。
 */
export interface ModelBase {
  name?: string
  api?: string
  baseUrl?: string
  input?: ('text' | 'image')[]
  reasoning?: boolean
  thinkingLevelMap?: Record<string, string | null | undefined>
  compat?: Record<string, unknown>
  contextWindow?: number
  maxTokens?: number
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  headers?: Record<string, string>
}

/** 内置 provider 的端点（provider 级 extends 的 baseURL 缺省值）。 */
export function builtinProviderBaseUrl(kit: DshKit, provider: string): string | undefined {
  return kit.builtinProviders().find((p) => p.id === provider)?.baseUrl
}

/** 内置目录是否存在该 provider。 */
export function hasBuiltinProvider(kit: DshKit, provider: string): boolean {
  return kit.getBuiltinProviders().includes(provider)
}

/** 内置 provider 的全部模型 id（UI extends 选择器用）。 */
export function builtinModelIds(kit: DshKit, provider: string): string[] {
  if (!hasBuiltinProvider(kit, provider)) return []
  return kit.getBuiltinModels(provider).map((m) => m.id)
}

/** 查单个内置模型为继承 base；未命中返回 undefined。 */
export function builtinModelBase(kit: DshKit, provider: string, modelId: string): ModelBase | undefined {
  if (!hasBuiltinProvider(kit, provider)) return undefined
  const model = kit.getBuiltinModels(provider).find((m) => m.id === modelId)
  if (model === undefined) return undefined
  return {
    name: model.name,
    api: model.api,
    baseUrl: model.baseUrl,
    input: [...model.input],
    reasoning: model.reasoning,
    ...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: { ...model.thinkingLevelMap } }),
    ...(model.compat === undefined ? {} : { compat: { ...(model.compat as Record<string, unknown>) } }),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { ...model.cost },
    ...(model.headers === undefined ? {} : { headers: { ...model.headers } }),
  }
}

/**
 * provider 级 extends 的全量模型继承：route 不写 models 时，
 * 以继承源 provider 的全部内置模型作为条目（每个条目 base 即其自身）。
 */
export function inheritedCatalogEntries(
  kit: DshKit,
  provider: string,
): { id: string; base: ModelBase }[] {
  if (!hasBuiltinProvider(kit, provider)) return []
  return kit.getBuiltinModels(provider).map((model) => ({
    id: model.id,
    base: builtinModelBase(kit, provider, model.id) ?? {},
  }))
}
