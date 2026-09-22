/**
 * settings 命名空间字面量（纯常量，零依赖）。
 * 服务端以字面量注册 settings section（用户层配置落 $DSH_HOME/settings.yaml，
 * 热生效）；与行级 cordis Config 共用同一份 schemastery schema（config.ts）。
 * @module @dsh-plus/web-cache-headers/ns
 */
export const SETTINGS_NS = 'dsh-plus-web-cache-headers'
