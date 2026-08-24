/**
 * 调和规划器（纯函数）：期望态 × 文件态 × loader 态 × lifeboat journal → 动作序列。
 *
 * 顺序约定：
 * - 禁用路径：先 preset 后 host（先撤模型面工具，再撤 host 后端——host 行多为
 *   preset 行的服务后端，反过来会让在途 preset 会话的 fiber 失去依赖）。
 * - 启用路径：先 host 后 preset（先恢复后端，再恢复模型面工具）。
 *
 * lifeboat 冲突：目标 host 行命中 lifeboat 隔离记录时，启用动作被拒绝
 * （写入前拦截，错误进 journal），禁用动作照常（已隔离态天然一致）。
 * @module feature-toggle/reconcile
 */
import { CATALOG, findFeature } from './catalog.ts'
import type { PatchClassification } from './patch-file.ts'
import type { PresetFileState } from './preset-file.ts'

/** 调和输入（全部只读快照）。 */
export interface ReconcileInput {
  /** 期望态：features dict（settings ns 解析值）。 */
  desired: Record<string, boolean>
  /** profile patch 文件分类快照。 */
  patch: PatchClassification
  /** 托管预设文件状态快照（文件不存在时 undefined）。 */
  preset: PresetFileState | undefined
  /** loader 实际条目态：host 行 id → enablement（未知行缺省）。 */
  loader: Map<string, boolean>
  /** lifeboat 已隔离的插件名集合（journal kind=quarantine 的对象）。 */
  quarantined: ReadonlySet<string>
}

/** 执行动作。 */
export type PlanAction =
  | { kind: 'preset-write'; disabledIds: Set<string> }
  | { kind: 'patch-write'; disabledIds: Set<string> }
  | { kind: 'ensure-managed-preset' }
  | { kind: 'teardown-managed-preset' }

/** 规划结果。 */
export interface Plan {
  /** 有序动作序列（空 = 已一致，无事可做）。 */
  actions: PlanAction[]
  /** 因 lifeboat 隔离而被拒绝的启用请求（功能 id + 行 id），进 journal/告警。 */
  rejected: Array<{ feature: string; row: string }>
}

/** 汇总期望禁用的 host / preset 行集合（期望值缺省 = 启用）。 */
export function desiredRows(desired: Record<string, boolean>): {
  host: Set<string>
  preset: Set<string>
} {
  const host = new Set<string>()
  const preset = new Set<string>()
  for (const [featureId, enabled] of Object.entries(desired)) {
    if (enabled) continue
    const feature = findFeature(featureId)
    if (feature === undefined) continue
    for (const row of feature.rows.host) host.add(row)
    for (const row of feature.rows.preset) preset.add(row)
  }
  return { host, preset }
}

/** 是否需要托管预设（任一 preset 平面功能被禁用）。 */
export function needsManagedPreset(desired: Record<string, boolean>): boolean {
  for (const [featureId, enabled] of Object.entries(desired)) {
    if (enabled) continue
    const feature = findFeature(featureId)
    if (feature !== undefined && feature.rows.preset.length > 0) return true
  }
  return false
}

/** lifeboat 隔离判定：host 行 id（dsh-plus 插件行与插件 name 同字面量）。 */
export function isQuarantined(row: string, quarantined: ReadonlySet<string>): boolean {
  return quarantined.has(row)
}

/**
 * 规划。文件态以「管理条目 + 外部条目 + 预设行态」三源合成：
 * - patch 期望禁用集合 = desired host 行 -（已有外部 disabled 条目的行——
 *   外部条目已达成禁用，无需管理条目）。
 * - preset 期望禁用集合 = desired preset 行（仅当预设文件存在且行存在时才需要写）。
 */
export function plan(input: ReconcileInput): Plan {
  const rejected: Plan['rejected'] = []
  const { desired } = input

  // lifeboat 冲突：期望启用但行被隔离 → 拒绝该功能的启用（维持禁用态）。
  // 注意：冲突只影响 host 行；preset 行与 lifeboat 无关。
  const effectiveDesired: Record<string, boolean> = { ...desired }
  for (const feature of CATALOG) {
    if (effectiveDesired[feature.id] !== true) continue
    const conflicting = feature.rows.host.find((row) => isQuarantined(row, input.quarantined))
    if (conflicting !== undefined) {
      effectiveDesired[feature.id] = false
      rejected.push({ feature: feature.id, row: conflicting })
    }
  }
  const effective = desiredRows(effectiveDesired)

  const actions: PlanAction[] = []

  // ── preset 平面 ──
  const usePreset = needsManagedPreset(effectiveDesired)
  if (usePreset) {
    actions.push({ kind: 'ensure-managed-preset' })
    if (input.preset !== undefined) {
      const target = new Set<string>()
      let needsWrite = false
      for (const row of effective.preset) {
        if (!input.preset.present.has(row)) continue
        target.add(row)
        if (input.preset.disabled.get(row) !== true) needsWrite = true
      }
      // 期望启用但文件里 disabled 的行也要写（删除标记）
      for (const [row, disabled] of input.preset.disabled) {
        if (disabled && !effective.preset.has(row)) {
          target.add(row)
          needsWrite = true
        }
      }
      if (needsWrite) actions.push({ kind: 'preset-write', disabledIds: target })
    }
  } else {
    // 无 preset 平面需求：若托管预设存在且带禁用标记，清理之；
    // 预设仍保留（避免反复创建/销毁触发 generation 抖动），仅清标记。
    if (input.preset !== undefined) {
      const stale = [...input.preset.disabled.entries()]
        .filter(([, disabled]) => disabled)
        .map(([row]) => row)
      if (stale.length > 0) {
        actions.push({ kind: 'ensure-managed-preset' })
        actions.push({ kind: 'preset-write', disabledIds: new Set<string>() })
      }
    }
    // enabled=false（插件总开关关）时由引擎层下发 teardown（需要能删除目录，
    // 纯文件态看不出「是否应彻底移除」——由引擎按 config.enabled 决定）。
  }

  // ── host 平面 ──
  // 外部条目已 disabled 的行无需管理条目；期望启用的行若有管理条目则需写。
  const externalDisabled = new Set(
    input.patch.external
      .filter((entry) => entry.disabled === true)
      .map((entry) => entry.id as string),
  )
  const managedIds = new Set(input.patch.managed.map((entry) => entry.id as string))
  const patchTarget = new Set<string>()
  for (const row of effective.host) {
    if (externalDisabled.has(row)) continue
    patchTarget.add(row)
  }
  let patchNeedsWrite = false
  for (const row of patchTarget) {
    if (!managedIds.has(row)) {
      patchNeedsWrite = true
      break
    }
  }
  if (!patchNeedsWrite) {
    for (const id of managedIds) {
      if (!patchTarget.has(id)) {
        patchNeedsWrite = true
        break
      }
    }
  }
  if (patchNeedsWrite) actions.push({ kind: 'patch-write', disabledIds: patchTarget })

  // 排序：禁用路径（存在 preset 写）先 preset 后 host；启用路径反之。
  const presetIdx = actions.findIndex((action) => action.kind === 'preset-write')
  const patchIdx = actions.findIndex((action) => action.kind === 'patch-write')
  const disabling = presetIdx >= 0 && patchIdx >= 0 && patchTarget.size > 0
  if (presetIdx >= 0 && patchIdx >= 0 && presetIdx > patchIdx && !disabling) {
    // 启用路径：host 先于 preset
    const [patchAction] = actions.splice(patchIdx, 1)
    if (patchAction !== undefined) actions.unshift(patchAction)
  }
  return { actions, rejected }
}
