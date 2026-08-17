/**
 * 提供商/模型/思考档位目录：配置卡片的下拉数据源。
 * 镜像官方 api-proxy `buildModelCatalog`（session.models RPC）的构建方式：
 * `ctx.llm.listProviders()` → `listModels()` → `resolveModelInfo()`，
 * 附 `ctx.subagents.list()` 的已注册子代理 provider 名（卡片按此行合成空行）。
 * 目录仅作建议性数据源，不参与运行期路由。
 * @module subagent-model/catalog
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LlmReasoningEffortInfo } from '@deepseek-ai/dsh-llm'

export interface CatalogEffort {
  id: string
  name: string
  description?: string
}

export interface CatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: {
    defaultEffort?: string
    efforts: CatalogEffort[]
  }
}

export interface CatalogProvider {
  id: string
  name: string
  models: CatalogModel[]
}

export interface CatalogFailure {
  id: string
  name: string
  message: string
}

export interface ModelCatalog {
  providers: CatalogProvider[]
  failures: CatalogFailure[]
  /** 已注册的子代理 provider 名（spawn/fork/…），卡片据此合成配置行。 */
  subagentProviders: string[]
}

function toEffort(effort: LlmReasoningEffortInfo): CatalogEffort {
  return {
    id: String(effort.id),
    name: effort.name,
    ...effort.description === undefined ? {} : { description: effort.description },
  }
}

/**
 * 构建目录。单个提供商失败只进入 failures，不拖垮其余组；
 * 无模型的组被丢弃（与官方 buildModelCatalog 同语义）。
 */
export async function buildModelCatalog(ctx: Context): Promise<ModelCatalog> {
  const llm = ctx.get('llm')
  if (llm === undefined) {
    return { providers: [], failures: [], subagentProviders: subagentProvidersOf(ctx) }
  }
  const catalog = await Promise.all(llm.listProviders().map(async (provider) => {
    try {
      const models = await llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await llm.resolveModelInfo(provider.id, model.id)
        const reasoning = resolved.reasoning === undefined ? undefined : {
          efforts: resolved.reasoning.efforts.map(toEffort),
          ...resolved.reasoning.defaultEffort === undefined
            ? {}
            : { defaultEffort: String(resolved.reasoning.defaultEffort) },
        }
        return {
          id: model.id,
          name: model.name,
          ...model.description === undefined ? {} : { description: model.description },
          ...reasoning === undefined ? {} : { reasoning },
        }
      }))
      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  return {
    providers: catalog
      .filter((item) => item.kind === 'group' && item.group.models.length > 0)
      .map((item) => item.kind === 'group' ? item.group : undefined)
      .filter((group): group is CatalogProvider => group !== undefined),
    failures: catalog
      .filter((item) => item.kind === 'failure')
      .map((item) => item.kind === 'failure' ? item.failure : undefined)
      .filter((failure): failure is CatalogFailure => failure !== undefined),
    subagentProviders: subagentProvidersOf(ctx),
  }
}

/** 已注册的子代理 provider 名（llm 服务缺失时同样返回，卡片仍可渲染）。 */
function subagentProvidersOf(ctx: Context): string[] {
  const subagents = ctx.get('subagents')
  return subagents === undefined ? [] : [...subagents.list()]
}
