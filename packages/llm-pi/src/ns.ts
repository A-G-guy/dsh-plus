/**
 * settings 命名空间字面量（纯常量，零依赖，浏览器半可安全引入）。
 * 服务端直接以字面量注册（0.1.2-alpha.2 起 dsh-settings 对命名空间做编译期
 * 语法校验，见 config.ts），浏览器半将其作为 settings.plugin.item keyed 槽位的
 * key —— 同一字面量两处共用，防止漂移。
 * 契约：该槽位按「卡片编辑的 settings 命名空间」作 key 分发，
 * 官方配置页只渲染 key 命中 Host 已注册命名空间的卡片。
 * @module llm-pi/ns
 */
export const SETTINGS_NS = 'dsh-plus-llm-pi'
