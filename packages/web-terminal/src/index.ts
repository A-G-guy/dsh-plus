/**
 * dsh 插件：Web 内嵌持久化终端工作台（宿主半）。
 *
 * 面向「人类交互终端」（区别于官方 ctx.terminals 的模型向 PTY 接缝——
 * 那套强制 TERM=dumb / PS1 受控提示符 / owner 必须为存活 Agent，且
 * web profile 组合树未提供行，见 docs/README.md 选型记录）：
 * - node-pty 孵化真实交互 shell（TERM=xterm-256color、加载用户 rc）；
 * - 会话生命周期独立于浏览器连接：关闭面板仅 detach，dsh 运行期间保活，
 *   重新 attach 时回放 scrollback（类 tmux detach/attach）；
 * - REST（create/list/kill/rename）+ 单条 WebSocket 多路复用（attach/
 *   detach/input/resize/output/exit），背压超限丢帧靠重连重放自愈；
 * - 空闲自动清理（零挂载且零输入输出超时才杀，后台跑构建的会话不误伤）。
 *
 * 安全：本插件不做鉴权，每个请求/升级先过 `web-terminal/access` serial
 * 事件接缝（监听器抛错即拒，同 web-files 模式）；Origin/Host 一致性
 * 校验防 DNS rebinding 与跨站 WS（终端是 RCE 级暴露面）。
 * @module @dsh-plus/web-terminal
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type WebTerminalConfig } from './config.ts'
import { registerHttpApi } from './http-api.ts'
import { WebTerminalService } from './registry.ts'

export const name = 'dsh-plus-web-terminal'

export const inject = ['webServer', 'settings'] as const

export type { WebTerminalConfig }
export { Config, WebTerminalService }

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTerminal: WebTerminalService
  }
}

export function apply(ctx: Context, config: WebTerminalConfig): void {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.plugin(WebTerminalService, config)
    // 路由注册读 ctx.webTerminal：经二级 inject 显式声明依赖，
    // Service init 完成后才进入注册（避免 cannot get without inject）。
    webCtx.inject(['webTerminal'], (serviceCtx) => {
      registerHttpApi(serviceCtx)
    })
  })
}
