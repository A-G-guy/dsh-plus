/**
 * settings 命名空间 + 路由/缓存/全局键常量（纯常量，零依赖）。
 * node 半（路由服务、注入行）与浏览器半（注册/注销、清理）共享同一来源，
 * 避免两侧字面量漂移。
 * @module @dsh-plus/web-shell-sw/ns
 */
export const SETTINGS_NS = 'dsh-plus-web-shell-sw'

/** index-inject `kind:'global'` 注入的配置对象键。 */
export const SW_GLOBAL_KEY = '__DSH_PLUS_WEB_SHELL_SW__'

/** sw.js 精确路由（注册与更新检查都打这里）。 */
export const SW_SCRIPT_PATH = '/dsh-plus/shell-sw.js'

/**
 * Cache Storage 缓存名（同时是版本号）。
 * SW 脚本逻辑变更时手动 +1：activate 阶段删除前缀相同、名字不同的旧缓存。
 */
export const SW_CACHE_NAME = 'dsh-shell-v1'

/** 缓存名前缀（禁用清理与版本升级都按它扫全量）。 */
export const SW_CACHE_PREFIX = 'dsh-shell-'
