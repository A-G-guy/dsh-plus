/**
 * 浏览器半共享小件：错误码文案映射与复制助手（设置页与会话控件共用）。
 * @module secret-env/client/common
 */
import { ApiError } from './api.ts'

/** 端点错误 → 本地化文案（未知码回落 internal）。 */
export function errorText(t: (key: string) => string, error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'internal'
  const text = t(`error.${code}`)
  // locale.bind 对缺失键原样回显键名，据此判断回落。
  return text === `error.${code}` ? t('error.internal') : text
}

/** 复制文本到剪贴板（clipboard API 缺席时退 execCommand）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 回落：非安全上下文（如非 localhost 直连）无 clipboard API。
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
