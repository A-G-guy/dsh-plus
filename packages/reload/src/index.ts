/**
 * dsh 插件：内置重新加载。
 * 职责：设置页「重新加载」按钮（浏览器半）与 /reload 命令（host 半），
 * 两段确认（一次性 token）+ 可取消倒计时后，对 systemd 托管的 dsh-web 执行
 * `sudo systemctl restart --no-block`；服务恢复后浏览器轮询 bootId 变化并自动刷新。
 *
 * 安全边界：非 systemd 托管 / 单元非 active / sudo 免密缺失 → 一律拒绝调度；
 * 有 running agent 时需显式 force。无持久态，进程重启即回到 idle。
 *
 * 与 lifeboat 的关系：不联动代码——重启后若兄弟插件加载失败，
 * lifeboat 既有隔离机制自动止血；本插件自身亦在其 dsh-plus-* 守护范围内。
 * @module @dsh-plus/reload
 */
import type { Context } from '@deepseek-ai/cordis'

import { agentsOf, countRunning } from './agents.ts'
import { type CommandDeps, registerReloadCommand } from './command.ts'
import { Config, type ReloadConfig } from './config.ts'
import { runPreflight, systemRunner } from './preflight.ts'
import { registerReloadRoutes } from './routes.ts'
import { ReloadScheduler } from './scheduler.ts'

export const name = 'dsh-plus-reload'

export { Config }

export function apply(ctx: Context, config: ReloadConfig): void {
  if (!config.enabled) return
  const logger = ctx.logger('reload')
  const onError = (message: string): void => logger.warn(message)

  const scheduler = new ReloadScheduler({
    unitName: config.unitName,
    confirmTokenTtlMs: config.confirmTokenTtlMs,
    serverGraceMs: config.serverGraceMs,
    onError,
  })

  // agents 服务缺席（非交互组合）时降级为 0：running 防线仅在能观测时生效。
  let runningAgents = (): number => 0
  ctx.inject(['agents'], (agentCtx) => {
    runningAgents = () => countRunning(agentsOf(agentCtx))
  })

  const commandDeps: CommandDeps = {
    scheduler,
    preflight: () => runPreflight(config.unitName, process.pid, systemRunner),
    runningAgents: () => runningAgents(),
  }

  ctx.inject(['commands'], (commandCtx) => {
    registerReloadCommand(commandCtx, commandDeps)
  })

  ctx.inject(['webServer'], (webCtx) => {
    registerReloadRoutes(webCtx, {
      scheduler,
      config,
      runningAgents: () => runningAgents(),
      onError,
    })
  })
}
