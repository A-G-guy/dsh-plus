/**
 * 图片标识形态（uuid）：画廊 imageId 与上传 uploadId 共用同一约束。
 * 既是路由参数白名单，也是路径拼接的穿越防线（单一事实源）。
 * @module image-studio/images/id
 */

const IMAGE_ID_RE = /^[a-f0-9-]{36}$/

/** 是否为合法图片标识（未知类型一律 false）。 */
export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_ID_RE.test(value)
}
