/**
 * settings 命名空间字面量（纯常量，零依赖，浏览器半可安全引入）。
 * 服务端经 settingsNamespace() 品牌化后使用（config.ts），浏览器半将其作为
 * settings.plugin.item keyed 槽位的 key（价目卡片）。
 * @module usage-panel/ns
 */
export const SETTINGS_NS = 'dsh-plus-usage-panel'
