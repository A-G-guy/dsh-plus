/**
 * pi-ai 内置目录的浏览/搜索后端（纯函数，node 侧单测直测）。
 *
 * 为什么在服务端搜：浏览器半拿不到 pi-ai（只能读本插件的 HTTP 端点），且
 * 匹配/排序逻辑放服务端才能进 `node --test`（本仓无 DOM 测试设施）。
 * 目录规模（40+ provider / 1500 模型）用按 kit 备忘的全量快照 + 内存过滤完全够用，
 * 每次搜索只把当前页（默认 40 条）序列化给浏览器。
 *
 * 字段不钉死：模型事实由 `builtinModelFacts` 现场读取（见 catalog/builtin.ts），
 * 官方 pi-ai 新增参数字段会自动出现在 `rest` 里，界面按原样展示。
 * @module llm-pi/catalog/browse
 */

import type { DshKit } from '../resolve-dsh.ts'
import {
  type BuiltinModelFacts,
  type BuiltinProviderEntry,
  builtinModelFacts,
  builtinProviderEntries,
} from './builtin.ts'

/** 浏览器可消费的模型条目（纯 JSON；函数面一律不进）。 */
export interface BuiltinModelInfo {
  provider: string
  /** 发送给 provider 的请求 id。 */
  id: string
  /** `provider/id` 路径 id（extends 引用与复制用）。 */
  path: string
  /** 显示名（pi-ai 目录给的 name）。 */
  name: string
  /** 请求协议。 */
  api: string
  baseUrl: string
  contextWindow: number
  maxTokens: number
  input: ('text' | 'image')[]
  reasoning: boolean
  thinkingLevelMap?: Record<string, string | null>
  compat?: Record<string, unknown>
  /** 目录给出但未单列的其余字段（cost / inputLimits / headers 等），原样展示。 */
  rest: Record<string, unknown>
  /** 当前生效协议集合能否服务该模型（false = 不能加进任何 pi route）。 */
  servable: boolean
}

/** 浏览筛选条件（全部可选；缺省 = 不加该维度过滤）。 */
export interface BrowseQuery {
  /** 模糊搜索串（空白分隔多词，全部词都要命中）。 */
  q?: string
  /** 供应商（pi-ai provider id）精确匹配。 */
  provider?: string
  /** 请求协议精确匹配。 */
  api?: string
  /** 只要推理模型。 */
  reasoning?: boolean
  /** 只要支持图片输入的模型。 */
  image?: boolean
  /** 只列本插件可服务的模型；缺省 true。 */
  servableOnly?: boolean
  /** 起始下标（缺省 0）。 */
  offset?: number
  /** 每页条数（缺省 {@link BROWSE_DEFAULT_LIMIT}，上限 {@link BROWSE_MAX_LIMIT}）。 */
  limit?: number
}

export interface BrowseResult {
  /** 命中总数（应用 servableOnly 之后）。 */
  total: number
  /** 仅因协议不可服务而被隐藏的条数（servableOnly 打开时才有意义）。 */
  servableHidden: number
  offset: number
  limit: number
  items: BuiltinModelInfo[]
}

export const BROWSE_DEFAULT_LIMIT = 40
export const BROWSE_MAX_LIMIT = 100

/** 全量快照按 kit 备忘（同一 kit 实例的目录在进程内不变）。 */
const snapshotCache = new WeakMap<DshKit, BuiltinModelInfo[]>()

/** 归一化：小写 + 去掉分隔符（`/ - _ . 空格`），用于子序列匹配。 */
function compact(text: string): string {
  return text.toLowerCase().replace(/[\s/\-_.]+/g, '')
}

/** 按分隔符切词（小写），用于词首命中判定。 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s/\-_.]+/)
    .filter((word) => word.length > 0)
}

/**
 * 模糊匹配得分：越小越相关；不匹配返回 undefined。
 * 分级：完全相等 0 < 整体前缀 1 < 词首前缀 2 < 子串 3 < 归一化相等 4 <
 * 归一化前缀 5 < 首字母缩写 6+（同一档内以命中跨度加权，越紧凑越小）。
 *
 * 缩写匹配要求首字符落在**词首**（`deepseek-flash` 的 `d`、`flash` 的 `f`）：
 * 否则任何长路径都会命中任意短查询（实测 `kimi` 会命中
 * `cloudflare-ai-gateway/workers-ai/@cf/ibm-granite/...`——wokers 里的 k 起头也能凑出
 * 子序列），搜索质量崩坏。跳字过多（超过 needle 长度 4 倍）同样判不命中。
 */
export function fuzzyScore(query: string, target: string): number | undefined {
  const needle = query.toLowerCase()
  if (needle.length === 0) return 0
  const haystack = target.toLowerCase()
  if (haystack === needle) return 0
  if (haystack.startsWith(needle)) return 1
  if (words(target).some((word) => word.startsWith(needle))) return 2
  if (haystack.includes(needle)) return 3
  const compactNeedle = compact(query)
  const compactTarget = compact(target)
  if (compactNeedle.length === 0) return 0
  if (compactTarget === compactNeedle) return 4
  if (compactTarget.startsWith(compactNeedle)) return 5
  if (compactNeedle.length === 1) return 6
  // 首字母缩写：needle 首字符必须是某个词的首字符，其余按顺序命中；
  // 命中跨度越紧凑越相关（同一档内以跨度/上限为小数权重，越紧越小）。
  const first = needle[0] as string
  const spanCap = compactNeedle.length * 4 + 4
  let best: number | undefined
  for (const start of wordStarts(target)) {
    if (haystack[start] !== first) continue
    let cursor = 1
    let last = start
    for (let i = start + 1; i < haystack.length && cursor < compactNeedle.length; i += 1) {
      const ch = haystack[i] as string
      if (/[\s/\-_.]/.test(ch)) continue
      if (ch === compactNeedle[cursor]) {
        cursor += 1
        last = i
      }
    }
    if (cursor < compactNeedle.length) continue
    const span = last - start + 1
    if (span > spanCap) continue
    const score = 6 + span / spanCap
    if (best === undefined || score < best) best = score
  }
  return best
}

/** 词首下标（按分隔符切分的每个词的首字符位置）。 */
function wordStarts(text: string): number[] {
  const out: number[] = []
  let atStart = true
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string
    if (/[\s/\-_.]/.test(ch)) {
      atStart = true
      continue
    }
    if (atStart) {
      out.push(i)
      atStart = false
    }
  }
  return out
}

/** 单条记录的多字段得分：取最相关字段；全部字段都不匹配返回 undefined。 */
function scoreOf(query: string, info: BuiltinModelInfo): number | undefined {
  let best: number | undefined
  for (const field of [info.path, info.id, info.name, info.provider]) {
    const score = fuzzyScore(query, field)
    if (score === undefined) continue
    // path 命中比 id/name 命中更相关（用户复制/extends 用的就是 path）
    const weighted = field === info.path ? score : score + 2
    if (best === undefined || weighted < best) best = weighted
  }
  return best
}

/** 多词 AND：每个词都要有命中，得分取各词之和（词少者更相关由长度自然体现）。 */
function multiScore(query: string, info: BuiltinModelInfo): number | undefined {
  const tokens = query.split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return 0
  let total = 0
  for (const token of tokens) {
    const score = scoreOf(token, info)
    if (score === undefined) return undefined
    total += score
  }
  return total
}

function toInfo(kit: DshKit, facts: BuiltinModelFacts): BuiltinModelInfo {
  return {
    provider: facts.provider,
    id: facts.id,
    path: facts.path,
    name: facts.name,
    api: facts.api,
    baseUrl: facts.baseUrl,
    contextWindow: facts.contextWindow,
    maxTokens: facts.maxTokens,
    input: facts.input,
    reasoning: facts.reasoning,
    ...(facts.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: facts.thinkingLevelMap }),
    ...(facts.compat === undefined ? {} : { compat: facts.compat }),
    rest: facts.rest,
    servable: kit.protocols.includes(facts.api),
  }
}

/** 全量模型条目（按目录顺序：provider 排序即 pi-ai 目录顺序，模型同）。 */
export function listModelInfos(kit: DshKit): BuiltinModelInfo[] {
  const cached = snapshotCache.get(kit)
  if (cached !== undefined) return cached
  const out: BuiltinModelInfo[] = []
  for (const provider of kit.getBuiltinProviders()) {
    for (const model of kit.getBuiltinModels(provider)) {
      const facts = builtinModelFacts(provider, model)
      if (facts !== undefined) out.push(toInfo(kit, facts))
    }
  }
  snapshotCache.set(kit, out)
  return out
}

/** 供应商条目（含模型数与显示名）。 */
export function listProviders(kit: DshKit): BuiltinProviderEntry[] {
  return builtinProviderEntries(kit)
}

/**
 * 紧凑协议索引 `{provider: {modelId: api}}`：浏览器半据此推断某个 route 当前
 * 实际生效的协议（route 级 `api` 缺省时由模型继承值决定），用于一键添加前的冲突检查。
 */
export function buildApiIndex(
  infos: readonly BuiltinModelInfo[],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const info of infos) {
    const perProvider = out[info.provider] ?? {}
    perProvider[info.id] = info.api
    out[info.provider] = perProvider
  }
  return out
}

function matchesFilters(info: BuiltinModelInfo, query: BrowseQuery): boolean {
  if (query.provider !== undefined && query.provider.length > 0 && info.provider !== query.provider)
    return false
  if (query.api !== undefined && query.api.length > 0 && info.api !== query.api) return false
  if (query.reasoning === true && !info.reasoning) return false
  if (query.image === true && !info.input.includes('image')) return false
  return true
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return BROWSE_DEFAULT_LIMIT
  return Math.min(Math.floor(value), BROWSE_MAX_LIMIT)
}

/**
 * 搜索 + 过滤 + 分页。无搜索串时按目录顺序（provider/id）返回；
 * 有搜索串时按相关度排序，同分按路径字典序稳定。
 */
export function browseModels(kit: DshKit, query: BrowseQuery = {}): BrowseResult {
  const all = listModelInfos(kit)
  const servableOnly = query.servableOnly !== false
  const limit = clampLimit(query.limit)
  const offset = Math.max(0, Math.floor(query.offset ?? 0))
  const q = (query.q ?? '').trim()

  let servableHidden = 0
  const matched: { info: BuiltinModelInfo; score: number }[] = []
  for (const info of all) {
    if (!info.servable) {
      if (servableOnly) servableHidden += 1
      if (servableOnly) continue
    }
    if (!matchesFilters(info, query)) continue
    const score = q.length === 0 ? 0 : multiScore(q, info)
    if (score === undefined) continue
    matched.push({ info, score })
  }
  if (q.length > 0) {
    // 同分优先更短的路径（更具体的命中），再按字典序稳定
    matched.sort((left, right) =>
      left.score === right.score
        ? left.info.path.length - right.info.path.length ||
          left.info.path.localeCompare(right.info.path)
        : left.score - right.score,
    )
  }
  return {
    total: matched.length,
    servableHidden,
    offset,
    limit,
    items: matched.slice(offset, offset + limit).map((entry) => entry.info),
  }
}
