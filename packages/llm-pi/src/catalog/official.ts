/**
 * 官方模型目录数据源：adapter: deepseek 的 route 的继承 base。
 *
 * 目录取自 dsh-llm-deepseek 的 resolveAdapterOptions({}, undefined)——
 * 即官方 DEFAULT_MODELS 经 schema 默认值补全后的形态（含视觉模型的
 * inputModalities / imagePixelBudget / imageMaxBytes），跟随 dsh 树升级
 * 自动更新，不在本仓库复制一份硬编码副本。
 * @module llm-pi/catalog/official
 */
import type { DshKit } from '../resolve-dsh.ts'

/** 官方目录可提供的可继承模型字段（DeepSeekCatalogModel 的可继承子集）。 */
export interface OfficialModelBase {
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: ('text' | 'image')[]
  imagePixelBudget?: number
  imageMaxBytes?: number
}

interface OfficialCatalog {
  baseUrl: string
  models: Map<string, OfficialModelBase>
}

/** 按 kit 备忘（kit 实例在进程内唯一，目录随 dsh 树版本固定）。 */
const cache = new WeakMap<DshKit, OfficialCatalog>()

function catalogOf(kit: DshKit): OfficialCatalog {
  const hit = cache.get(kit)
  if (hit !== undefined) return hit
  if (kit.deepseek === undefined) {
    throw new Error('llm-pi: 官方模型目录需要 dsh-llm-deepseek（当前运行时套件不含）')
  }
  const resolved = kit.deepseek.resolveAdapterOptions({} as never, undefined)
  const models = new Map<string, OfficialModelBase>()
  for (const model of resolved.models) {
    models.set(model.id, {
      ...(model.name === undefined ? {} : { name: model.name }),
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
      ...(model.inputModalities === undefined
        ? {}
        : { input: [...model.inputModalities] as ('text' | 'image')[] }),
      ...(model.imagePixelBudget === undefined ? {} : { imagePixelBudget: model.imagePixelBudget }),
      ...(model.imageMaxBytes === undefined ? {} : { imageMaxBytes: model.imageMaxBytes }),
    })
  }
  const catalog: OfficialCatalog = { baseUrl: resolved.baseURL, models }
  cache.set(kit, catalog)
  return catalog
}

/** 官方端点（route 配 extends: 'deepseek' 且未显式 baseURL 时的缺省值）。 */
export function officialBaseUrl(kit: DshKit): string {
  return catalogOf(kit).baseUrl
}

/** 查单个官方模型为继承 base；未命中返回 undefined。 */
export function officialModelBase(kit: DshKit, modelId: string): OfficialModelBase | undefined {
  const base = catalogOf(kit).models.get(modelId)
  return base === undefined ? undefined : { ...base }
}

/** 官方目录的全部模型 id（route 级 extends: 'deepseek' 的全量继承与诊断用）。 */
export function officialModelIds(kit: DshKit): string[] {
  return [...catalogOf(kit).models.keys()]
}
