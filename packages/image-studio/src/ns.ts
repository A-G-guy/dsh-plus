/**
 * settings 命名空间字面量（纯常量，零依赖，浏览器半可安全引入）。
 * 服务端直接以字面量注册（settings 编译期校验命名空间语法，见 config.ts），
 * 浏览器半将其作为 settings.plugin.item keyed 槽位的 key（配置卡片）。
 * @module image-studio/ns
 */
export const SETTINGS_NS = 'dsh-plus-image-studio'
