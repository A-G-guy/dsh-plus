/**
 * extends 继承解析：把 provider/model 条目上的继承引用解析为继承 base。
 *
 * 数据源优先级（三级）：
 * 1. pi-ai 内置目录（含官方校正，最可信）；
 * 2. models.dev 快照（仅内置未收录的新模型，字段保守）；
 * 3. 都未命中 → 手写模型（无 base，必填字段由配置/兜底给出）。
 *
 * 引用语法：`"provider/model"` 显式跨源；裸 `"model"` 随 route 级 extends 源；
 * 条目缺省 extends 时以 route extends 源下的同名模型为 base。
 * @module llm-pi/inherit
 */
import type { ModelBase } from './catalog/builtin.ts'
import { builtinModelBase } from './catalog/builtin.ts'
import type { ModelsDevSource } from './catalog/models-dev.ts'
import type { ModelEntryConfig, ProviderProfileConfig } from './config.ts'
import type { DshKit } from './resolve-dsh.ts'

export interface BaseResolution {
  base: ModelBase
  source: 'builtin' | 'models-dev' | 'none'
  /** 实际命中的继承源 provider（诊断/错误消息用）。 */
  sourceProvider?: string
}

export class ExtendsError extends Error {}

/** 解析 "provider/model" 或裸 "model" 引用。 */
export function parseExtendsRef(raw: string): { provider?: string; model: string } {
  const slash = raw.indexOf('/')
  if (slash < 0) return { model: raw }
  const provider = raw.slice(0, slash)
  const model = raw.slice(slash + 1)
  if (provider.length === 0 || model.length === 0 || model.includes('/')) {
    throw new ExtendsError(`extends 引用 ${JSON.stringify(raw)} 非法：应为 "provider/model" 或 "model"`)
  }
  return { provider, model }
}

function lookup(
  kit: DshKit,
  modelsDev: ModelsDevSource | undefined,
  provider: string,
  model: string,
): BaseResolution | undefined {
  const builtin = builtinModelBase(kit, provider, model)
  if (builtin !== undefined) return { base: builtin, source: 'builtin', sourceProvider: provider }
  const dev = modelsDev?.lookup(provider, model)
  if (dev !== undefined) return { base: dev, source: 'models-dev', sourceProvider: provider }
  return undefined
}

/**
 * 解析一个模型条目的继承 base。
 * @throws ExtendsError 显式 extends 引用不存在（写入时拒绝，指明引用名）。
 */
export function resolveModelBase(
  route: string,
  profile: ProviderProfileConfig,
  entry: ModelEntryConfig,
  kit: DshKit,
  modelsDev: ModelsDevSource | undefined,
): BaseResolution {
  const where = `provider "${route}" model "${entry.id}"`
  if (entry.extends === undefined) {
    if (profile.extends === undefined) return { base: {}, source: 'none' }
    return (
      lookup(kit, modelsDev, profile.extends, entry.id) ?? { base: {}, source: 'none' }
    )
  }
  const ref = parseExtendsRef(entry.extends)
  const provider = ref.provider ?? profile.extends
  if (provider === undefined) {
    throw new ExtendsError(
      `${where}: extends ${JSON.stringify(entry.extends)} 是裸模型 id，但本 route 未配置 provider 级 extends 查找源`,
    )
  }
  const hit = lookup(kit, modelsDev, provider, ref.model)
  if (hit === undefined) {
    throw new ExtendsError(
      `${where}: extends 引用 "${provider}/${ref.model}" 在内置目录与 models.dev 快照中都不存在`,
    )
  }
  return hit
}
