/**
 * settings 命名空间字面量（纯常量，零依赖，浏览器半可安全引入）。
 * 服务端经 settingsNamespace() 品牌化后使用（config.ts），浏览器半将其作为
 * settings.plugin.item keyed 槽位的 key —— 同一字面量两处共用，防止漂移。
 * @module access-gate/ns
 */
export const SETTINGS_NS = 'dsh-plus-access-gate'
