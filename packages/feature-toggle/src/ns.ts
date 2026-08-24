/**
 * settings 命名空间字面量（纯常量，零依赖，浏览器半可安全引入）。
 * 服务端经 settingsNamespace() 品牌化后使用（config.ts），浏览器半将其作为
 * settings.plugin.item keyed 槽位的 key —— 同一字面量两处共用，防止漂移。
 * @module feature-toggle/ns
 */
export const SETTINGS_NS = 'dsh-plus-feature-toggle'

/** 托管预设 id（$DSH_HOME/.agent-presets/dsh-plus-toggles/）。 */
export const MANAGED_PRESET_ID = 'dsh-plus-toggles'

/** profile 用户 patch 文件中，本插件管理条目的识别标记（comment 形式）。 */
export const MANAGED_MARKER = 'dsh-plus-feature-toggle:managed'
