/**
 * 配置卡片草稿的纯逻辑（无 React/JSX，供 node --test 直接导入）：
 * 解析值 → 草稿、草稿 → 提交形状，以及结算延迟的校验。
 * @module web-boot-timing/client/draft
 */
/** 结算延迟允许区间（与 config.ts 的 schema 约束一致：step 100 / min 200 / max 10000）。 */
export const SETTLE_MIN_MS = 200
export const SETTLE_MAX_MS = 10_000

/** settings 命名空间的解析值。 */
export interface ConfigValue {
  enabled: boolean
  settleMs: number
}

/** 编辑草稿：数值以文本承载（保存时校验并折算）。 */
export interface Draft {
  enabled: boolean
  settleMsText: string
}

/** 结算延迟是否可用：区间内的整数。 */
export function settleTextOk(text: string): boolean {
  if (!/^\d+$/.test(text.trim())) return false
  const value = Number(text)
  return value >= SETTLE_MIN_MS && value <= SETTLE_MAX_MS
}

export function draftFromValue(value: ConfigValue): Draft {
  return { enabled: value.enabled, settleMsText: String(value.settleMs) }
}

/** 草稿 → 提交形状（调用方保证已通过校验）。 */
export function toPatch(draft: Draft): Record<string, unknown> {
  return { enabled: draft.enabled, settleMs: Number(draft.settleMsText) }
}
