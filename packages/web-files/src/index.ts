/**
 * dsh 插件：Web 内嵌类 SFTP 文件浏览与编辑（宿主半）。
 *
 * 注册 `/dsh-plus/web-files` 前缀 HTTP 路由（list/read/write/mkdir/rename/
 * delete/upload/download），供本包的浏览器半（`./client.ts`，经 dsh.client
 * 声明装载）调用，使远程/移动端访问无需本地编辑器即可预览与编辑服务器文件。
 *
 * 本插件不做鉴权：每个请求先过 `web-files/access` serial 事件接缝，
 * 统一安全围栏由后续安全插件以监听器形式实现。
 * @module @dsh-plus/web-files
 */
import type { Context } from '@deepseek-ai/cordis'

import { registerFilesApi } from './files-api.ts'

export const name = 'dsh-plus-web-files'

export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (webCtx) => {
    registerFilesApi(webCtx)
  })
}
