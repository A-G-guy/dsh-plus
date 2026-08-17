/**
 * 共享纯函数库：文本变换。
 * 不依赖 cordis / dsh，可在任意插件与测试中复用。
 * @module @dsh-plus/shared
 */

export const TRANSFORM_OPS = ['uppercase', 'lowercase', 'reverse', 'length'] as const

export type TransformOp = (typeof TRANSFORM_OPS)[number]

export function isTransformOp(value: string): value is TransformOp {
  return (TRANSFORM_OPS as readonly string[]).includes(value)
}

/** 对输入文本执行指定变换；未知操作抛错（边界校验）。 */
export function transformText(text: string, op: TransformOp): string {
  switch (op) {
    case 'uppercase':
      return text.toUpperCase()
    case 'lowercase':
      return text.toLowerCase()
    case 'reverse':
      return [...text].reverse().join('')
    case 'length':
      return String([...text].length)
  }
}
