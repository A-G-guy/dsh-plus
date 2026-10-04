/**
 * 浏览器半共享小件：错误码文案映射、变量名输入规则
 * （设置页与会话控件共用；名称规则与 node 半 names.ts 同源）。
 * 复制助手已收编到 `@dsh-plus/shared/client`（llm-pi 目录浏览器是第二个使用方）。
 * @module secret-env/client/common
 */
import { copyText } from '@dsh-plus/shared/client'

import { type NameError, normalizeSuffix, validateSuffix } from '../names.ts'
import { ApiError } from './api.ts'
import { errorKeyOf, type Translate } from './i18n.ts'

export { copyText }

/** 端点错误 → 本地化文案（未知码回落 internal）。 */
export function errorText(t: Translate, error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'internal'
  // 错误码来自端点响应，运行期收窄到字典已知键；未知码回落 internal。
  const key = errorKeyOf(code)
  return key === null ? t('error.internal') : t(key)
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
