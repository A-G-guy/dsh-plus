/**
 * route 生效协议推断与「一键添加」可用性判定（纯函数，node --test 直测）。
 *
 * 为什么需要它：服务端物化的协议规则是「route 级 api 优先，其次逐模型继承值，
 * 全 route 必须一致」；卡片要在**不保存**的前提下告诉用户某个模型能不能加进
 * 某个 route（否则用户会撞上一次保存失败）。协议索引由服务端 /catalog 的
 * `apis`（provider → modelId → api）提供，覆盖全部内置模型。
 * @module llm-pi/client/route-fit
 */

import type { WireModelInfo } from './api.ts'
import type { ProviderDraft } from './draft.ts'

/** 协议索引：`{provider: {modelId: api}}`（服务端 /catalog 的 apis）。 */
export type ApiIndex = Record<string, Record<string, string>>

/** route 生效协议事实。 */
export interface RouteApiFacts {
  /** 唯一生效协议；混合或无法判定时为 undefined。 */
  api?: string
  /** 模型之间存在多个协议（保存会被服务端拒绝）。 */
  mixed: boolean
  /** 无法判定协议的模型数（条目既无 extends 又无 route 级 extends 源）。 */
  unresolved: number
}

/**
 * 解析条目指向的继承引用（与服务端 inherit.ts 同规则）：
 * `"provider/model"` 显式引用；裸 `"model"` 随 route 级 extends 源；
 * 条目无 extends 时按同名模型挂在 route 级 extends 源下。
 * 两段任一为空（无引用可解析）时返回空串。
 */
export function entryReference(
  entry: { id: string; extends: string },
  routeExtends: string,
): { provider: string; model: string } {
  const raw = entry.extends.trim()
  if (raw === '') return { provider: routeExtends.trim(), model: entry.id.trim() }
  const slash = raw.indexOf('/')
  if (slash > 0) return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) }
  return { provider: routeExtends.trim(), model: raw }
}

/**
 * 推断 route 当前实际生效的协议：
 * - route 级 `api` 显式给出即用它（物化时它压过继承值）；
 * - 否则逐模型查**其引用指向的模型**的协议（注意是引用目标，不是条目 id：
 *   生产配置普遍用别名条目，如 `{id: 'glm-5.3', extends: 'zai/glm-5.3'}`）：
 *   单一 → 该协议；多个 → mixed；引用解析不出来计 unresolved。
 */
export function routeApiFacts(provider: ProviderDraft, apis: ApiIndex): RouteApiFacts {
  const explicit = provider.api.trim()
  if (explicit !== '') return { api: explicit, mixed: false, unresolved: 0 }
  const found = new Set<string>()
  let unresolved = 0
  for (const model of provider.models) {
    const ref = entryReference(model, provider.extends)
    if (ref.provider === '' || ref.model === '') {
      unresolved += 1
      continue
    }
    const api = apis[ref.provider]?.[ref.model]
    if (api === undefined) unresolved += 1
    else found.add(api)
  }
  if (found.size === 1) return { api: [...found][0] ?? '', mixed: false, unresolved }
  return { mixed: found.size > 1, unresolved }
}

/** route 是否由 PiAiAdapter 服务（`adapter` 在卡片的 extra 里原样往返）。 */
export function isPiRoute(provider: ProviderDraft): boolean {
  const adapter = provider.extra['adapter']
  return adapter === undefined || adapter === 'pi'
}

/** 可作为「一键添加」目标的 route（deepseek 路由不适用 pi-ai 继承）。 */
export function targetRoutes(providers: Record<string, ProviderDraft>): string[] {
  return Object.entries(providers)
    .filter(([, provider]) => isPiRoute(provider))
    .map(([route]) => route)
    .sort((left, right) => left.localeCompare(right))
}

/** 不能添加的原因（界面据此给文案）。 */
export type AddBlockReason =
  | 'unsupported'
  | 'duplicate'
  | 'protocol-conflict'
  | 'route-mixed'
  | 'no-route'

export type AddEligibility = { ok: true } | { ok: false; reason: AddBlockReason; detail?: string }

/**
 * 判定某内置模型能否加进目标 route：
 * 协议不受支持 → unsupported；route 不存在 → no-route；同 id 已在 → duplicate；
 * route 已混用多个协议 → route-mixed（保存本来就会失败，先提示修好）；
 * route 已有确定协议且与模型不同 → protocol-conflict（保存一定失败，提前拦）。
 */
export function addEligibility(options: {
  model: WireModelInfo
  provider: ProviderDraft | undefined
  apis: ApiIndex
}): AddEligibility {
  const { model, provider, apis } = options
  if (!model.servable) return { ok: false, reason: 'unsupported', detail: model.api }
  if (provider === undefined) return { ok: false, reason: 'no-route' }
  if (provider.models.some((entry) => entry.id.trim() === model.id)) {
    return { ok: false, reason: 'duplicate' }
  }
  const facts = routeApiFacts(provider, apis)
  if (facts.mixed) return { ok: false, reason: 'route-mixed' }
  if (facts.api !== undefined && facts.api !== model.api) {
    return { ok: false, reason: 'protocol-conflict', detail: facts.api }
  }
  return { ok: true }
}
