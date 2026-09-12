/**
 * 逐协议 compat 校验：门控表与取值约束**从官方 dsh-llm-pi-ai 安装副本自动继承**
 * （见 compat-gates.ts），不再手抄镜像。
 *
 * 语义：官方门控表是 compat 可配性的唯一事实源——按协议分型（offer/withhold），
 * withhold 字段（官方内置目录已为对应厂商设置，如 openRouterRouting/zaiToolStream/
 * sendSessionAffinityHeaders/supportsToolSearch/supportsMidConvoEffort 等）写时
 * 拒绝并提示以目录 provider 名为 route；未知键拒绝；无值键（null/undefined）拒绝
 * （对齐官方 assertOfferedCompatFields："写了但没生效"的表面状态不允许）。
 *
 * 历史：本表曾是手抄镜像，0.1.5-rc.1 官方扩容 offer 字段而旧表漏收，导致官方可配
 * 字段被本插件**误拒**（静默功能缺失、无任何报错）。现改为现场推导：官方新增字段
 * 即自动可用，`tests/compat-gates.test.ts` 直读官方 bundle 守门推导正确性。
 *
 * pi-ai 侧消费语义：getCompat 逐字段 `??` 覆盖 detectCompat 的 baseURL/名称猜测；
 * undefined 视为未设置（无法显式清空检测值）。
 * @module llm-pi/compat
 */
import type { CompatDisposition, CompatTable, CompatValue } from './compat-gates.ts'
import { FALLBACK_TABLE } from './compat-gates.ts'
import type { ProtocolId } from './config.ts'

export type { CompatDisposition, CompatValue } from './compat-gates.ts'

/**
 * 生效门控表：由 resolve-dsh 的套件加载流程经 {@link installCompatTable} 注入
 * （与 PiAiAdapter 同源——即 dsh 树或 vendored 副本里**正在运行**的那份官方代码）。
 * 未注入时用 FALLBACK_TABLE（纯函数测试路径/极端启动顺序下的保守兜底）。
 */
let active: CompatTable = FALLBACK_TABLE

/** 注入推导结果（幂等；resolve-dsh 在套件加载后调用一次）。 */
export function installCompatTable(table: CompatTable): void {
  active = table
}

/** 当前生效表的来源诊断（状态行/日志）。 */
export function compatTableInfo(): { source: CompatTable['source']; problem?: string } {
  return active.problem === undefined
    ? { source: active.source }
    : { source: active.source, problem: active.problem }
}

/** 某协议某字段的可配性（'offer'/'withhold'；未列出 = 无此字段）。 */
export function compatDispositionOf(api: string, field: string): CompatDisposition | undefined {
  return active.gates[api]?.[field]
}

/** 某协议全部可配置（offer）的 compat 键（UI 渲染字段组与校验共用）。 */
export function compatFieldsOf(api: ProtocolId | string): readonly string[] {
  const gate = active.gates[api]
  if (gate === undefined) return []
  return Object.entries(gate).flatMap(([field, disposition]) =>
    disposition === 'offer' ? [field] : [],
  )
}

/** 某协议某 offer 字段的取值约束（UI 渲染开关/下拉用）。 */
export function compatFieldSpec(api: string, field: string): CompatValue | undefined {
  return active.gates[api]?.[field] === 'offer' ? active.specs[field] : undefined
}

/** 官方声明的全部可配置字段（未知键报错时列出，对齐官方 allOfferedCompatFields）。 */
function allOfferedFields(): string[] {
  const out = new Set<string>()
  for (const gate of Object.values(active.gates)) {
    for (const [field, disposition] of Object.entries(gate)) {
      if (disposition === 'offer') out.add(field)
    }
  }
  return [...out]
}

function checkValue(field: string, spec: CompatValue, value: unknown, where: string): void {
  if (spec === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${where}: compat.${field} 必须是布尔值`)
    return
  }
  if (spec === 'integer') {
    // 官方 z.number().step(1)：整数（小数/NaN/Infinity 均不合格）
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(`${where}: compat.${field} 必须是整数`)
    }
    return
  }
  if (spec === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${where}: compat.${field} 必须是数字`)
    }
    return
  }
  if (spec === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${where}: compat.${field} 必须是对象`)
    }
    return
  }
  if (typeof value !== 'string' || !spec.includes(value)) {
    throw new Error(
      `${where}: compat.${field} 必须是 ${spec.map((v) => JSON.stringify(v)).join(' | ')} 之一`,
    )
  }
}

/**
 * 校验一份 compat 字典对指定协议合法（对齐官方门控语义 + schema 值约束）：
 * - 未知键/withhold 字段拒绝（官方写时拒绝，替代旧版静默丢弃）；
 * - 值类型/枚举按官方 schema 校验；
 * - 无值键（null/undefined）拒绝（官方 assertOfferedCompatFields 同款）。
 */
export function validateCompat(
  api: string,
  compat: Record<string, unknown> | undefined,
  where: string,
): void {
  if (compat === undefined) return
  const gate = active.gates[api]
  if (gate === undefined) {
    throw new Error(
      `${where}: 协议 ${JSON.stringify(api)} 无 compat 字段表（支持：${Object.keys(active.gates).join(', ')}）`,
    )
  }
  const offered = compatFieldsOf(api)
  for (const [key, value] of Object.entries(compat)) {
    const disposition = gate[key]
    if (disposition !== 'offer') {
      if (disposition === 'withhold') {
        throw new Error(
          `${where}: compat.${key} 官方按协议 withhold（内置目录已为对应厂商设置该开关）；` +
            '请以目录 provider 名作为 route 名（继承目录值），或移除该字段',
        )
      }
      throw new Error(
        `${where}: compat.${key} 不是 ${api} 协议的合法字段（可配置字段：${offered.join(', ')}；` +
          `官方全部可配字段：${allOfferedFields().join(', ')}）`,
      )
    }
    if (value === undefined || value === null) {
      throw new Error(`${where}: compat.${key} 未设置值；给出值或移除该键（留空不会生效）`)
    }
    // 官方 schema 未给出取值约束的字段（未来新增而推导未覆盖）跳过值校验，
    // 由官方调用链自行裁决——宁可放行也不误拒。
    const spec = active.specs[key]
    if (spec !== undefined) checkValue(key, spec, value, where)
  }
}

/**
 * 逐字段合并 compat 层（后者覆盖前者），丢弃 undefined/null 值。
 * 层序：继承源（仅同协议）→ route 级 → 模型级。
 */
export function mergeCompat(
  ...layers: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {}
  for (const layer of layers) {
    if (layer === undefined) continue
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined && value !== null) merged[key] = value
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}
