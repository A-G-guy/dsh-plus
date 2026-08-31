/**
 * `$` 触发补全的纯核心（零 DOM / React / cordis，node 直接单测）：
 * - detectSecretTrigger：光标处 `$<query>` 命中检测（边界规则对齐官方
 *   input-trigger 的 / 与 @：起草开头、空白后、标点后开闸；词中 $ 不触发）；
 * - filterCandidates：按 query 过滤+排序（前缀命中优先）；
 * - applyChipCorrection：渲染文本偏移 → 草稿投影偏移的芯片修正。
 * @module secret-env/client/menu-core
 */

/** 一次 `$` 命中：query 为 $ 到光标间的文本，[start, end) 为草稿投影中的令牌区间。 */
export interface SecretHit {
  readonly query: string
  readonly start: number
  readonly end: number
}

/** 菜单候选项（全局与会话密钥的统一视图，纯展示数据）。 */
export interface SecretCandidate {
  readonly envName: string
  readonly name: string
  readonly description: string
  readonly scope: 'global' | 'session'
  readonly once?: boolean
}

const WORD_CHAR = /[\p{L}\p{N}_]/u
const TOKEN_CHAR = /^[A-Za-z0-9_]$/

/**
 * 检测光标处的 `$` 触发令牌。词法：
 * - 从光标向左扫描，token 字符（字母/数字/下划线）继续，空白直接判负；
 * - 遇到 `$` 时校验词边界：起草开头 / 前字符为空白 / 前字符为非词字符（标点）
 *   才开闸——`foo$BAR` 这类词中 $ 不触发（与官方 URL 内 / 不触发同理）；
 * - 其余字符（如 `{`、`(`）终止扫描。
 */
export function detectSecretTrigger(draft: string, caret: number): SecretHit | null {
  if (caret <= 0 || caret > draft.length) return null
  for (let i = caret - 1; i >= 0; i--) {
    const ch = draft.charAt(i)
    if (/\s/u.test(ch)) return null
    if (ch !== '$') {
      if (!TOKEN_CHAR.test(ch)) return null
      continue
    }
    if (i > 0) {
      const prev = draft.charAt(i - 1)
      if (!/\s/u.test(prev) && WORD_CHAR.test(prev)) return null
    }
    return { query: draft.slice(i + 1, caret), start: i, end: caret }
  }
  return null
}

/** 两个命中的等价判定（抑制重复 setState）。 */
export function sameHit(a: SecretHit | null, b: SecretHit | null): boolean {
  if (a === null || b === null) return a === b
  return a.query === b.query && a.start === b.start && a.end === b.end
}

/** 按 query 过滤候选（大小写不敏感；变量名前缀命中排前，其余子串命中随后）。 */
export function filterCandidates(
  entries: readonly SecretCandidate[],
  query: string,
): SecretCandidate[] {
  const q = query.toUpperCase()
  const prefixed: SecretCandidate[] = []
  const partial: SecretCandidate[] = []
  for (const entry of entries) {
    if (q === '') {
      prefixed.push(entry)
      continue
    }
    if (entry.envName.toUpperCase().includes(q) || entry.name.toUpperCase().includes(q)) {
      if (entry.name.toUpperCase().startsWith(q) || entry.envName.toUpperCase().includes(`_${q}`)) {
        prefixed.push(entry)
      } else {
        partial.push(entry)
      }
    }
  }
  return [...prefixed, ...partial]
}

/** 一处芯片修正对：光标前芯片的渲染文本长与草稿投影长。 */
export interface ChipCorrection {
  readonly rendered: number
  readonly draft: number
}

/**
 * 渲染文本偏移 → 草稿投影偏移。contenteditable 中芯片（引用装饰器）的
 * 渲染文本与其草稿投影长度不等，光标渲染偏移需逐芯片修正。
 */
export function applyChipCorrection(
  renderedOffset: number,
  chipsBeforeCaret: readonly ChipCorrection[],
): number {
  let offset = renderedOffset
  for (const chip of chipsBeforeCaret) {
    offset -= chip.rendered - chip.draft
  }
  return Math.max(0, offset)
}
