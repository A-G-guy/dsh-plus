/**
 * loader 实际态闭环验证（纯函数）。
 *
 * 背景：patch 管理条目写入后依赖 dsh 的 watchUserPatches 热应用——这是对官方
 * 行为的隐式信任：官方若改变热应用策略（或 watcher 未生效），写入「成功」但
 * loader 里目标行仍启用，开关静默不生效。本模块把热生效从「信任」变「验证」：
 * patch 写入后的健康窗口内核对 loader 实际 enablement，未生效 → pendingRestart
 * （卡片红条提示重启路径）而不是静默无效果。
 *
 * loader 实际态来源：ctx.pluginInventory.list()（官方只读投影，Remote 名
 * pluginInventory/list）或直接 ctx.loader.entries()。此处只做纯比对，
 * 采集由引擎注入。
 * @module feature-toggle/loader-check
 */

/** loader 条目投影（pluginInventory entry 的最小面）。 */
export interface LoaderEntryView {
  entryId: string
  enabled: boolean
}

/** 闭环核对结果。 */
export interface VerifyOutcome {
  /** 全部目标行实际态与期望一致。 */
  ok: boolean
  /** 未生效的行（期望禁用但实际启用 / 期望启用但实际禁用）。 */
  mismatched: string[]
}

/**
 * 核对目标 host 行的实际 enablement。
 * loader 视图中缺席的目标行视为未生效（组合树里根本没有该行 id——行被官方
 * 重命名/移除的形态），一并计入 mismatched。
 */
export function verifyLoaderState(
  targetRows: ReadonlySet<string>,
  expectDisabled: ReadonlySet<string>,
  entries: readonly LoaderEntryView[],
): VerifyOutcome {
  const actual = new Map<string, boolean>()
  for (const entry of entries) {
    // entryId 形如 "include:<id>"（嵌套组为 "include:<group>:<id>"）；顶层
    // patch 覆盖的目标行都在根层，取最后一段做精确匹配。
    const id = entry.entryId.split(':').pop() ?? entry.entryId
    actual.set(id, entry.enabled)
  }
  const mismatched: string[] = []
  for (const row of targetRows) {
    const enabled = actual.get(row)
    if (enabled === undefined) {
      mismatched.push(row)
      continue
    }
    const wantDisabled = expectDisabled.has(row)
    if (enabled === wantDisabled) mismatched.push(row)
  }
  return { ok: mismatched.length === 0, mismatched }
}
