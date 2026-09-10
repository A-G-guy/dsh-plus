/**
 * 官方图像尺寸规则与预设尺寸（口径取 gpt-image 系列当前代文档）：
 * - 快捷预设：auto + 三档推荐尺寸 + 常见宽屏/竖屏/2K/4K；
 * - 自定义尺寸：宽高均为 16 的倍数、长边 ≤3840、比例 1:3~3:1、
 *   总像素 655,360–8,294,400；
 * - 自由输入始终保留：预设只是快捷入口，非白名单。
 * 同一份规则同时服务宿主边界校验（params/spec）与浏览器半即时提示（参数表单）。
 * 纯函数零依赖，浏览器半可安全引入。
 * @module image-studio/params/size
 */

/** 自定义尺寸约束（数值即官方文档口径）。 */
export interface SizeRule {
  /** 宽高须为其整数倍。 */
  multiple: number
  /** 长边上限（px）。 */
  maxEdge: number
  /** 总像素下限/上限。 */
  minPixels: number
  maxPixels: number
  /** 长边与短边的比例上限（3 即 3:1）。 */
  maxAspect: number
}

/** GPT Image 代自定义尺寸规则。 */
export const IMAGE_SIZE_RULE: SizeRule = Object.freeze({
  multiple: 16,
  maxEdge: 3840,
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxAspect: 3,
})

/** 免校验取值：实际尺寸由模型按提示词决定。 */
export const SIZE_AUTO = 'auto'

/** 预设尺寸（快捷选择项，非合法值白名单）。 */
export interface SizePreset {
  value: string
  /** 面向用户的说明（比例/用途）。 */
  label: string
}

/** 预设尺寸表（顺序即展示序：常用在前；全部满足 16 倍数约束）。 */
export const SIZE_PRESETS: readonly SizePreset[] = Object.freeze([
  Object.freeze({ value: SIZE_AUTO, label: 'auto（由模型决定）' }),
  Object.freeze({ value: '1024x1024', label: '1024×1024 方形 1:1' }),
  Object.freeze({ value: '1536x1024', label: '1536×1024 横向 3:2' }),
  Object.freeze({ value: '1024x1536', label: '1024×1536 纵向 2:3' }),
  Object.freeze({ value: '2048x1152', label: '2048×1152 宽屏 16:9' }),
  Object.freeze({ value: '1152x2048', label: '1152×2048 竖屏 9:16' }),
  Object.freeze({ value: '3840x2160', label: '3840×2160 4K 16:9' }),
  Object.freeze({ value: '2160x3840', label: '2160×3840 4K 9:16' }),
])

/** 校验结论：通过或一条面向用户的原因（中文，直接展示）。 */
export type SizeCheck = { ok: true } | { ok: false; message: string }

const OK: SizeCheck = { ok: true }

/** 「宽x高」规范形态（小写 x、无空白；`auto` 原样）。 */
export function normalizeImageSize(value: string): string {
  const text = value.trim()
  if (text === SIZE_AUTO) return SIZE_AUTO
  return text.replace(/[×✕✖]/g, 'x').replace(/\s+/g, '').toLowerCase()
}

/** 规范化后的「宽x高」形态。 */
const SIZE_PATTERN = /^(\d{2,5})x(\d{2,5})$/

/**
 * 校验一个尺寸取值（`auto` 或「宽x高」，容忍大小写/全角乘号/空白）。
 * @param value - 用户输入或预设值（提交/保存前校验）。
 * @param rule - 尺寸约束（缺省 GPT Image 代规则）。
 */
export function checkImageSize(value: string, rule: SizeRule = IMAGE_SIZE_RULE): SizeCheck {
  const text = normalizeImageSize(value)
  if (text === SIZE_AUTO) return OK
  const match = SIZE_PATTERN.exec(text)
  if (match === null) return fail('需为「宽x高」（如 1024x1024）或 auto')
  const width = Number(match[1])
  const height = Number(match[2])
  if (width % rule.multiple !== 0 || height % rule.multiple !== 0) {
    return fail(`宽高需为 ${rule.multiple} 的倍数（当前 ${width}x${height}）`)
  }
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long > rule.maxEdge) return fail(`长边不能超过 ${rule.maxEdge}px（当前 ${long}px）`)
  if (long / short > rule.maxAspect) return fail(`宽高比不能超过 ${rule.maxAspect}:1`)
  const pixels = width * height
  if (pixels < rule.minPixels) return fail(`总像素不能少于 ${rule.minPixels}（当前 ${pixels}）`)
  if (pixels > rule.maxPixels) return fail(`总像素不能超过 ${rule.maxPixels}（当前 ${pixels}）`)
  return OK
}

function fail(message: string): SizeCheck {
  return { ok: false, message }
}
