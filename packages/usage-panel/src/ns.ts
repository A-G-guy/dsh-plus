/**
 * settings 命名空间字面量（纯常量，零依赖，浏览器半可安全引入）。
 * 服务端直接以字面量注册（dsh-settings 对命名空间做编译期
 * 语法校验，见 config.ts）；浏览器半把它作为配置卡片的注册键
 * （插件页配置卡片挂在 row/bundle config 槽位上，与命名空间解耦，
 * 见 shared/config-slots），
 * 同一字面量两处共用，防止漂移。
 * @module usage-panel/ns
 */
export const SETTINGS_NS = 'dsh-plus-usage-panel'
