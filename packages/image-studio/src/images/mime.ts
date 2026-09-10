/**
 * 图片 MIME 单一事实源：扩展名互转 + 魔数嗅探。
 * 上传边界只认官方 images 端点接受的位图格式（png/jpeg/webp/gif），
 * 不信任客户端声明的 content-type（防伪装文件落盘）。
 * 纯函数零依赖，宿主两半均可安全引入。
 * @module image-studio/images/mime
 */

/** 魔数嗅探窗口（最长特征序列 + 偏移）。 */
const SNIFF_BYTES = 16

/** 落盘扩展名 ← MIME（白名单外一律按 png 处理）。 */
export function extOfMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'png'
  }
}

/** MIME ← 落盘扩展名（读取回程；与 extOfMime 互逆）。 */
export function mimeOfExt(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

/** 前若干字节是否以 prefix 开头。 */
function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false
  return prefix.every((value, index) => bytes[offset + index] === value)
}

/** ASCII 特征序列 → 字节数组（'RIFF' / 'WEBP' 等容器标记）。 */
function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0))
}

/**
 * 魔数嗅探图片类型；非白名单格式返回 null。
 * @param bytes - 文件字节（只需前 16 字节即可判定）。
 */
export function detectImageMime(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, SNIFF_BYTES)
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) return 'image/gif'
  // WebP：RIFF 容器 + 第 8 字节起 'WEBP' 四字符码。
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp'
  return null
}
