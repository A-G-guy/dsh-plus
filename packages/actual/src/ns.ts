/**
 * settings 命名空间字面量（纯常量，零依赖）。
 *
 * 宿主以字面量注册 settings section（用户层配置经 dsh-settings-file 持久化，
 * 热生效）；与行级 cordis Config 共用同一份 schemastery schema（config.ts）。
 * 浏览器半的配置卡片按同一字面量读写。
 * @module @dsh-plus/actual/ns
 */
export const SETTINGS_NS = 'dsh-plus-actual'
