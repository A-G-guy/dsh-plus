/**
 * dsh-plus 主插件：思源笔记能力发现（MCP tools/list × kernel CLI help 树）
 * 与 `siyuan` agent 预设注册。
 *
 * 设计要点：
 * - 宿主行只提供 `siyuan` 服务与预设注册，不注册任何模型面工具——工具
 *   由预设挂载的子插件（@dsh-plus/siyuan-tools）在 agent 作用域注册，
 *   其他预设完全不受影响；
 * - 惰性 inject `agentPresets`（缺席的 profile 照常 active、只是不注册），
 *   register 在 effect 内后台完成、失败仅 warn，均不阻塞 boot；
 * - 卸载竞态（fiber 先于注册完成被卸下）沿用 agent-preset-chat 的
 *   disposed 守卫，晚到的 disposer 仍被调用，不泄漏预设子树。
 * @module @dsh-plus/siyuan
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import { Config, type SiyuanConfig } from './config.ts'
import { siyuanPresetDefinition } from './definition.ts'
import { SiyuanService } from './service.ts'

export const name = 'dsh-plus-siyuan'

/** 无硬 inject：agentPresets 经 apply 内惰性 inject 接线（缺席即空转）。 */
export const inject = [] as const

export { DEFAULT_ALWAYS_ASK, DEFAULT_READ_ACTIONS, DEFAULT_READ_TOOLS } from './config.ts'
export type {
  CapabilityDrift,
  CapabilityEntry,
  CapabilitySource,
  CliPlan,
  SiyuanConnection,
  SiyuanManifest,
  SiyuanStatus,
} from './contract.ts'
export { SIYUAN_PRESET_ID, siyuanPresetDefinition } from './definition.ts'
export { DEFAULT_PERSONA_PREFIX } from './prompt.ts'
export type { InvokeOptions } from './runtime.ts'
export { SiyuanService } from './service.ts'
export type { SiyuanConfig }
export { Config }

declare module '@deepseek-ai/cordis' {
  interface Context {
    siyuan: SiyuanService
  }
}

/**
 * 注册思源笔记预设；卸载时注销。
 * @param ctx - 宿主上下文。
 * @param config - 已验证的插件配置。
 */
export function apply(ctx: Context, config: SiyuanConfig): void {
  if (config.enabled !== true) return
  const logger = ctx.logger('siyuan')

  // 服务先行：子插件行 inject `siyuan`，预设激活即能接线。
  ctx.plugin(SiyuanService, config)

  ctx.inject(['agentPresets'], (scope) => {
    scope.effect(() => {
      let unregister: (() => Promise<void>) | undefined
      let disposed = false
      const definition: PresetDefinition = siyuanPresetDefinition(config)
      void scope.agentPresets
        .register(definition)
        .then((dispose) => {
          if (disposed) {
            void dispose()
            return
          }
          unregister = dispose
          logger.info(`registered agent preset [${definition.id}] ${definition.name ?? ''}`)
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          logger.warn(`register siyuan preset failed: ${detail}`)
        })
      return () => {
        disposed = true
        if (unregister !== undefined) void unregister()
      }
    }, 'siyuan: register siyuan preset')
  })
}
