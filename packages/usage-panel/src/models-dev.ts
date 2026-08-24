/**
 * models.dev 价目导入（host 半）：拉取公共静态 JSON 并折算为价目条目。
 * 纯数据变换可测；网络 fetch 由调用方注入（测试零网络）。
 * @module usage-panel/models-dev
 */

/** models.dev api.json 的最小投影（只取用到的字段）。 */
interface ModelsDevDoc {
  [provider: string]: {
    name?: string
    models?: Record<
      string,
      {
        name?: string
        cost?: {
          input?: number
          output?: number
          cache_read?: number
          cache_write?: number
        } | null
      }
    >
  } | null
}

export interface ImportedPrice {
  provider: string
  model: string
  inputPerMtok: number
  outputPerMtok: number
  cacheReadPerMtok: number
  cacheWritePerMtok: number
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 折算 models.dev 文档为价目条目（跳过无 cost 的模型；provider/model 小写键原样保留）。 */
export function importPrices(doc: ModelsDevDoc): ImportedPrice[] {
  const out: ImportedPrice[] = []
  for (const [providerId, provider] of Object.entries(doc)) {
    if (provider === null || typeof provider !== 'object') continue
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      const cost = model?.cost
      if (cost === null || cost === undefined) continue
      out.push({
        provider: providerId,
        model: modelId,
        inputPerMtok: finiteNonNegative(cost.input),
        outputPerMtok: finiteNonNegative(cost.output),
        cacheReadPerMtok: finiteNonNegative(cost.cache_read),
        cacheWritePerMtok: finiteNonNegative(cost.cache_write),
      })
    }
  }
  return out
}

/** 拉取 models.dev（代理可选）；返回原文（解析交给 importPrices，错误结构化上抛）。 */
export async function fetchModelsDev(
  url: string,
  proxy: string,
  load: (url: string, proxy: string) => Promise<string>,
): Promise<string> {
  return load(url, proxy)
}
