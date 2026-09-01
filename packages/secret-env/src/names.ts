/**
 * 变量名语法（纯函数，零依赖；node 半与浏览器半共用）：
 * 用户给出后缀（如 `GITHUB_TOKEN`），插件拼出完整受管变量名
 * `DSH_VAR_GITHUB_TOKEN`——即模型经 `env | grep ^DSH_` 可见、
 * 在 shell 命令中以 `$DSH_VAR_*` 引用的那个名字。
 * @module secret-env/names
 */

/** 受管变量名前缀（属 dsh-shell-env 的 DSH_* 受管命名空间）。 */
export const ENV_PREFIX = 'DSH_VAR_'

/** 后缀语法：POSIX 环境变量名，大写字母开头，总长（含前缀）不超过 79。 */
const SUFFIX_PATTERN = /^[A-Z][A-Z0-9_]*$/
const MAX_SUFFIX_LENGTH = 64

/** 名称校验失败码（端点与 UI 共用的结构化错误）。 */
export type NameError = 'empty' | 'bad-charset' | 'too-long'

/** 规范化用户输入：去空白并转大写。 */
export function normalizeSuffix(raw: string): string {
  return raw.trim().toUpperCase()
}

/** 校验规范化后的后缀；合法返回 null，非法返回失败码。 */
export function validateSuffix(suffix: string): NameError | null {
  if (suffix.length === 0) return 'empty'
  if (suffix.length > MAX_SUFFIX_LENGTH) return 'too-long'
  if (!SUFFIX_PATTERN.test(suffix)) return 'bad-charset'
  return null
}

/** 由后缀拼出完整受管变量名（调用方保证后缀已通过校验）。 */
export function envNameOf(suffix: string): string {
  return `${ENV_PREFIX}${suffix}`
}

/** 判断一个完整变量名是否属本插件管理（用于凭据热更事件过滤）。 */
export function isManagedEnvName(envName: string): boolean {
  return envName.startsWith(ENV_PREFIX) && envName.length > ENV_PREFIX.length
}

/** 由完整变量名反解后缀；非本插件名返回 undefined。 */
export function suffixOf(envName: string): string | undefined {
  return isManagedEnvName(envName) ? envName.slice(ENV_PREFIX.length) : undefined
}
