/**
 * 目录对拍告警（漂移检测，纯函数）。
 *
 * 背景：开关目标行 id 是对官方组合树的语义引用——官方升级 standard 预设时
 * 可能改组名、拆组、移行，失配后 syncPresetRows 对缺失行静默忽略，开关
 * 静默失效（最隐蔽的坑）。本模块把「静默失效」变「显性告警」：
 *
 * 1. **缺行检测**：catalog 登记的 preset 行不存在于源预设实际行清单 →
 *    该行受影响的开关将无效果，journal + 卡片黄条提示人工核对。
 * 2. **疑似新增检测**：源预设出现目录外的同族行（按行 id 前缀归族，如
 *    tool-subagent-* 归 subagents 族）→ 提示人工评估是否纳入开关。
 *
 * 输入是「源预设的行 id 清单」（扁平化，含嵌套组），由引擎从
 * agentPresets.read(sourcePresetId) 或托管预设文件解析获得。
 * @module feature-toggle/drift
 */
import { CATALOG } from './catalog.ts'

/** 漂移告警条目。 */
export interface DriftFinding {
  kind: 'missing-row' | 'suspected-new-row'
  /** 受影响的功能 id（missing-row）或行 id（suspected-new-row）。 */
  subject: string
  /** 人读描述（journal / 卡片直接展示）。 */
  detail: string
}

/** 行 id → 归属功能族的映射（catalog 数据推导）。 */
const ROW_OWNER: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const feature of CATALOG) {
    for (const row of [...feature.rows.host, ...feature.rows.preset]) {
      map.set(row, feature.id)
    }
  }
  return map
})()

/**
 * 归族启发式：行 id 与 catalog 各功能已登记行共享的最长前缀（按 '-' 分段）。
 * 如 tool-subagent-control 与已登记的 delegation 无共享前缀 → 无族；
 * subagent-spawn-in-process-v2 与 subagent-spawn-in-process 共享
 * 「subagent-spawn-in-process」前缀 → subagents 族。
 */
function ownerByPrefix(rowId: string): string | null {
  let best: { feature: string; depth: number } | null = null
  for (const [known, feature] of ROW_OWNER) {
    if (!rowId.startsWith(`${known}-`) && rowId !== known) continue
    const depth = known.split('-').length
    if (best === null || depth > best.depth) best = { feature, depth }
  }
  return best?.feature ?? null
}

/**
 * 对拍：源预设实际行清单 vs catalog。
 * @param sourceRows 源预设（或托管预设）扁平化后的全部行 id。
 * @param plane 只对拍该平面的 catalog 行（'preset' 或 'host'）。
 */
export function detectDrift(
  sourceRows: ReadonlySet<string>,
  plane: 'preset' | 'host',
): DriftFinding[] {
  const findings: DriftFinding[] = []
  const catalogRows = new Set<string>()
  for (const feature of CATALOG) {
    for (const row of plane === 'preset' ? feature.rows.preset : feature.rows.host) {
      catalogRows.add(row)
    }
  }

  // 缺行：catalog 登记 → 实际缺席
  for (const row of catalogRows) {
    if (sourceRows.has(row)) continue
    const feature = ROW_OWNER.get(row)
    if (feature === undefined) continue
    findings.push({
      kind: 'missing-row',
      subject: row,
      detail: `官方结构漂移：行 ${row} 不存在于源预设（影响功能 ${feature} 的开关，请核对 catalog）`,
    })
  }

  // 疑似新增：实际出现 → catalog 未登记 → 但与已登记行同前缀族
  for (const row of sourceRows) {
    if (catalogRows.has(row)) continue
    const owner = ownerByPrefix(row)
    if (owner === null) continue
    findings.push({
      kind: 'suspected-new-row',
      subject: row,
      detail: `官方疑似新增同族行 ${row}（与功能 ${owner} 的行同前缀），请评估是否纳入开关`,
    })
  }
  return findings
}

/** 是否存在任一缺行告警（卡片黄条聚合用）。 */
export function hasMissingRows(findings: readonly DriftFinding[]): boolean {
  return findings.some((finding) => finding.kind === 'missing-row')
}
