/**
 * settings 命名空间字面量（纯常量，零依赖）。
 *
 * 宿主以字面量注册 settings section（用户层配置落 profile 行级覆盖层
 * cordis.patch.yml，热生效）；与行级 cordis Config 共用同一份 schemastery schema。
 * 浏览器半的配置卡片按同一字面量读写。
 * @module @dsh-plus/actual/ns
 */
export const SETTINGS_NS = 'dsh-plus-actual'
