/**
 * 凭据引用名派生与校验：提供商预设 id → IMAGE_STUDIO_PRESET_<ID>。
 * 规则对齐《插件存储规范》：大写下划线、全大写、前缀属主。
 * 纯函数，零依赖。
 * @module image-studio/credentials
 */

/** 引用名前缀（属主段）。 */
const REF_PREFIX = 'IMAGE_STUDIO_PRESET_'

/** 预设 id 是否合法（kebab-case，用于引用名派生）。 */
export function isValidPresetId(id: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(id) && id.length <= 64
}

/** 预设 id → 凭据引用名（kebab → SNAKE 大写）。 */
export function credentialRefNameOf(presetId: string): string {
  if (!isValidPresetId(presetId)) {
    throw new Error(`非法提供商预设 id：${JSON.stringify(presetId)}`)
  }
  return `${REF_PREFIX}${presetId.replaceAll('-', '_').toUpperCase()}`
}
