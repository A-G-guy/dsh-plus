/**
 * settings 命名空间字面量 + 浏览器全局钩子名（纯常量，零依赖）。
 * 服务端以字面量注册 settings section（用户层配置落 $DSH_HOME/settings.yaml，
 * 热生效）；与行级 cordis Config 共用同一份 schemastery schema（config.ts）。
 * @module @dsh-plus/web-boot-timing/ns
 */
export const SETTINGS_NS = 'dsh-plus-web-boot-timing'

/**
 * index-inject `kind:'global'` 注入的配置对象键。
 * 浏览器半经 globalThis 读取；行缺席（插件禁用/服务缺席）即视为关闭，
 * 客户端零行为——与「结构守卫」语义一致。
 */
export const TIMING_GLOBAL_KEY = '__DSH_PLUS_WEB_BOOT_TIMING__'
