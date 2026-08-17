/**
 * dsh UI 插件模板（node 半）。浏览器半见 src/client.ts，经 ./client 导出 + tsdown 构建，
 * 由 dsh-client-modules 扫描进 __DSH_BOOT__；dsh-client-hmr 轮询构建产物实现热更。
 * 挂载点：dsh-client-ui-slots 的插槽体系（契约见 docs/reference）。
 * @module @dsh-plus/ui-mobile-fit
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-plus-ui-mobile-fit'

export function apply(_ctx: Context): void {
  // node 半：通常仅声明 client 模块；需要服务端配合时在此注册服务/工具。
}
