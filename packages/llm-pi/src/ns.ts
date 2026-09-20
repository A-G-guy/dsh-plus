/**
 * settings 命名空间字面量（纯常量，零依赖，浏览器半可安全引入）。
 * 服务端直接以字面量注册（0.1.2-alpha.2 起 dsh-settings 对命名空间做编译期
 * 语法校验，见 config.ts）；浏览器半把它作为配置卡片的注册键
 * （legacy settings.plugin.item keyed 槽位按「卡片编辑的 settings 命名空间」
 * 分发；0.1.6-alpha.2 起改挂插件页 row/bundle config，见 shared/config-slots），
 * 同一字面量两处共用，防止漂移。
 * @module llm-pi/ns
 */
export const SETTINGS_NS = 'dsh-plus-llm-pi'
