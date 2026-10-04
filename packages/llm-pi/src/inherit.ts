/**
 * extends 继承解析：把 provider/model 条目上的继承引用解析为继承 base。
 *
 * 数据源只有一个：**pi-ai 内置目录**（随已装 dsh 的 pi-ai 版本自动跟随，
 * 含官方校正的 compat/thinkingLevelMap/模态）。未命中即「手写条目」，
 * 必填字段由 route 级配置或兜底给出。models.dev 兜底源已随 0.1.43 移除——
 * 版本漂移靠「现场推导 + 状态行显示生效版本」处理，不引入第二份可能过期的目录。
 *
 * 引用语法：`"provider/model"` 显式引用；裸 `"model"` 随 route 级 extends 源；
 * 条目缺省 extends 时以 route extends 源下的同名模型为 base。
 * @module llm-pi/inherit
 */
import type { ModelBase } from './catalog/builtin.ts'
import { builtinModelBase } from './catalog/builtin.ts'
import type { ModelEntryConfig, ProviderProfileConfig } from './config.ts'
import type { DshKit } from './resolve-dsh.ts'

export interface BaseResolution {
  base: ModelBase
  source: 'builtin' | 'none'
  /** 实际命中的继承源 provider（诊断/错误消息用）。 */
  sourceProvider?: string
}

export class ExtendsError extends Error {}

/** 解析 "provider/model" 或裸 "model" 引用。 */
export function parseExtendsRef(raw: string): {
  provider?: string
  model: string
} {
  const slash = raw.indexOf('/')
  if (slash < 0) return { model: raw }
  const provider = raw.slice(0, slash)
  const model = raw.slice(slash + 1)
  if (provider.length === 0 || model.length === 0 || model.includes('/')) {
    throw new ExtendsError(
      `extends 引用 ${JSON.stringify(raw)} 非法：应为 "provider/model" 或 "model"`,
    )
  }
  return { provider, model }
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
): BaseResolution {
  const where = `provider "${route}" model "${entry.id}"`
  if (entry.extends === undefined) {
    if (profile.extends === undefined) return { base: {}, source: 'none' }
    const base = builtinModelBase(kit, profile.extends, entry.id)
    return base === undefined
      ? { base: {}, source: 'none' }
      : { base, source: 'builtin', sourceProvider: profile.extends }
  }
  const ref = parseExtendsRef(entry.extends)
  const provider = ref.provider ?? profile.extends
  if (provider === undefined) {
    throw new ExtendsError(
      `${where}: extends ${JSON.stringify(entry.extends)} 是裸模型 id，但本 route 未配置 provider 级 extends 查找源`,
    )
  }
  const base = builtinModelBase(kit, provider, ref.model)
  if (base === undefined) {
    throw new ExtendsError(
      `${where}: extends 引用 "${provider}/${ref.model}" 不在 pi-ai ${kit.versions.piAi ?? '?'} 的内置目录中` +
        `（可继承的 provider/模型见配置页「内置模型目录」，或用裸 model id 配合 route 级 extends）`,
    )
  }
  return { base, source: 'builtin', sourceProvider: provider }
}
