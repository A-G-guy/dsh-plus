/**
 * settings 命名空间字面量（纯常量，零依赖，浏览器半可安全引入）。
 * 服务端直接以字面量注册（0.1.2-alpha.2 起编译期校验，见 config.ts），
 * 浏览器半将其作为 settings.plugin.item keyed 槽位的 key（价目卡片）。
 * @module usage-panel/ns
 */
export const SETTINGS_NS = 'dsh-plus-usage-panel'
