/**
 * 逐协议 compat 校验：门控表与取值约束**从官方 dsh-llm-pi-ai 安装副本自动继承**
 * （见 official-surface.ts），不再手抄镜像。
 *
 * 语义分两档，取决于门控表当时来自哪里：
 * - **official（现场推导成功）**：官方门控表是兼容性的唯一事实源——按协议分型
 *   （offer/withhold），withhold 字段（官方内置目录已为对应厂商设置，如
 *   openRouterRouting/zaiToolStream/sendSessionAffinityHeaders 等）写时拒绝并提示以
 *   目录 provider 名为 route；未知键拒绝；无值键（null/undefined）拒绝（对齐官方
 *   assertOfferedCompatFields："写了但没生效"的表面状态不允许）。
 * - **fallback（推导失败，用最后已知快照）**：只拒绝快照中明确 withhold 的键，
 *   **未知键放行**交给官方适配器自身校验——表落后时"误拒官方新字段"比"多放一个键"
 *   严重得多（教训：静默功能缺失、无任何报错）。
 *
 * pi-ai 侧消费语义：getCompat 逐字段 `??` 覆盖 detectCompat 的 baseURL/名称猜测；
 * undefined 视为未设置（无法显式清空检测值）。
 * @module llm-pi/compat
 */

import type { ProtocolId } from './config.ts'
import type { CompatDisposition, CompatTable, CompatValue } from './official-surface.ts'
import { FALLBACK_TABLE } from './official-surface.ts'

export type { CompatDisposition, CompatValue } from './official-surface.ts'

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

/**
 * 生效表里出现过的协议键（运行期协议列表为空时的渲染兜底：
 * 套件异常也要让表单能画出来）。
 */
export function compatProtocols(): string[] {
  return Object.keys(active.gates)
}

/** 某协议被官方 withhold 的字段（内置目录已为对应厂商设置，写时拒绝）。 */
export function compatWithholdFieldsOf(api: ProtocolId | string): readonly string[] {
  const gate = active.gates[api]
  if (gate === undefined) return []
  return Object.entries(gate).flatMap(([field, disposition]) =>
    disposition === 'withhold' ? [field] : [],
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
 * - 未知键/withhold 字段拒绝（与官方写时拒绝同款）；
 * - 值类型/枚举按官方 schema 校验；
 * - 无值键（null/undefined）拒绝（官方 assertOfferedCompatFields 同款）。
 */
export function validateCompat(
  api: string,
  compat: Record<string, unknown> | undefined,
  where: string,
): void {
  if (compat === undefined) return
  const table = active
  const gate = table.gates[api]
  if (gate === undefined) {
    throw new Error(
      `${where}: 协议 ${JSON.stringify(api)} 无 compat 字段表（可配协议：${Object.keys(table.gates).join(', ')}）`,
    )
  }
  const offered = compatFieldsOf(api)
  // 回退快照可能落后于官方：未知键放行给官方适配器自身校验，只拦快照里明确的
  // withhold（详见文件头"语义分两档"）。
  const permissive = table.source === 'fallback'
  for (const [key, value] of Object.entries(compat)) {
    const disposition = gate[key]
    if (disposition !== 'offer') {
      if (disposition === 'withhold') {
        throw new Error(
          `${where}: compat.${key} 官方按协议 withhold（内置目录已为对应厂商设置该开关）；` +
            '请以目录 provider 名作为 route 名（继承目录值），或移除该字段',
        )
      }
      if (!permissive) {
        throw new Error(
          `${where}: compat.${key} 不是 ${api} 协议的合法字段（可配置字段：${offered.join(', ')}；` +
            `官方全部可配字段：${allOfferedFields().join(', ')}）`,
        )
      }
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
