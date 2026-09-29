/**
 * 客户端运行时探测：桌面端（Electron 壳）判据与官方同源——
 * `dsh-client-shortcuts` 等官方插件以 `'dshDesktop' in globalThis` 识别桌面壳。
 * @module reload/client/runtime
 */

/**
 * 当前是否运行在 DSH 桌面端。
 * @param scope 探测作用域（缺省全局；测试注入替身对象）。
 */
export function isDesktopRuntime(scope: typeof globalThis = globalThis): boolean {
  return 'dshDesktop' in scope
}
