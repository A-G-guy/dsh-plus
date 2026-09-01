/**
 * 浏览器半共享小件：错误码文案映射、复制助手与变量名输入规则
 * （设置页与会话控件共用；名称规则与 node 半 names.ts 同源）。
 * @module secret-env/client/common
 */
import { type NameError, normalizeSuffix, validateSuffix } from '../names.ts'
import { ApiError } from './api.ts'

/** 端点错误 → 本地化文案（未知码回落 internal）。 */
export function errorText(t: (key: string) => string, error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'internal'
  const text = t(`error.${code}`)
  // locale.bind 对缺失键原样回显键名，据此判断回落。
  return text === `error.${code}` ? t('error.internal') : text
}

/** 名称输入的实时规范化：键入即转大写（去空白交给保存时的 normalizeSuffix）。 */
export function liveName(raw: string): string {
  return raw.toUpperCase()
}

/** 名称输入的实时校验：空串不标错（必填兜底），其余按 names.ts 规则判定。 */
export function nameErrorOf(raw: string): NameError | null {
  if (raw.trim() === '') return null
  return validateSuffix(normalizeSuffix(raw))
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
