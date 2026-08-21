/**
 * dsh-plus remote-settings 插件（node 半）。浏览器半见 src/client.ts，
 * 经 ./client 导出 + tsdown 构建，由 dsh-client-modules 扫描进 __DSH_BOOT__。
 * 本插件无服务端逻辑：修复对象（settings describe mirror）完全存在于浏览器侧。
 * @module @dsh-plus/remote-settings
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-plus-remote-settings'

export function apply(_ctx: Context): void {
  // node 半：仅声明 client 模块；修复在浏览器半完成（见 src/client.ts）。
}
