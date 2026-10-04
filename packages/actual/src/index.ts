/**
 * dsh-plus 主插件：Actual Budget 能力发现（CLI help 树 × 进程内 MCP tools/list）
 * 与 `actual` agent 预设注册。
 *
 * 设计要点（与思源主插件同构）：
 * - 宿主行只提供 `actual` 服务与预设注册，不注册任何模型面工具——工具由预设
 *   挂载的子插件（@dsh-plus/actual-tools）在 agent 作用域注册，其他预设完全
 *   不受影响；同时"格式一"（MCP 服务）作为进程内能力主源被真实使用，可移植件
 *   （stdio 入口）与它共用同一份 `createActualMcpServer`；
 * - 惰性 inject `agentPresets`（缺席的 profile 照常 active、只是不注册），
 *   register 在 effect 内后台完成、失败仅 warn，均不阻塞 boot；
 * - 卸载竞态（fiber 先于注册完成被卸下）沿用 agent-preset-chat 的 disposed
 *   守卫，晚到的 disposer 仍被调用，不泄漏预设子树。
 * @module @dsh-plus/actual
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import { unwrapVolatile } from '@dsh-plus/shared'

import { type ActualConfig, type ActualConfigFields, Config } from './config.ts'
import { actualPresetDefinition } from './definition.ts'
import { ActualService } from './service.ts'

export const name = 'dsh-plus-actual'

/** 无硬 inject：agentPresets 经 apply 内惰性 inject 接线（缺席即空转）。 */
export const inject = [] as const

export type {
  ActualCliBinding,
  ActualManifest,
  ActualStatus,
  CapabilityDrift,
  CapabilityEntry,
  CapabilitySource,
  CliPlan,
} from '@dsh-plus/actual-mcp'
export {
  actionOf,
  askDisplayReason,
  type ClassifySettings,
  classifyAction,
  DEFAULT_ALWAYS_ASK,
  DEFAULT_READ_ACTIONS,
  DEFAULT_READ_TOOLS,
  toSettings,
} from '@dsh-plus/actual-mcp'
export { ACTUAL_PRESET_ID, actualPresetDefinition } from './definition.ts'
export type { McpSessionLike } from './mcp-session.ts'
export { createInProcessSession } from './mcp-session.ts'
export { SETTINGS_NS } from './ns.ts'
export { DEFAULT_PERSONA_PREFIX } from './prompt.ts'
export type { InvokeOptions } from './runtime.ts'
export { ActualService } from './service.ts'
export type { ActualConfig, ActualConfigFields }
export { Config }

declare module '@deepseek-ai/cordis' {
  interface Context {
    actual: ActualService
  }
}

/**
 * 注册 Actual Budget 预设；卸载时注销。
 * @param ctx - 宿主上下文。
 * @param config - 已验证的插件配置。
 */
export function apply(ctx: Context, config: ActualConfig | ActualConfigFields): void {
  // 活动引用现取即热；预设声明在注册时定格，之后的改动经工具行策略热取。
  const plain = (): ActualConfig => unwrapVolatile(config) as ActualConfig
  if (plain().enabled !== true) return
  const logger = ctx.logger('actual')

  // 服务先行：子插件行 inject `actual`，预设激活即能接线。
  ctx.plugin(ActualService, config)

  ctx.inject(['agentPresets'], (scope) => {
    scope.effect(() => {
      let unregister: (() => Promise<void>) | undefined
      let disposed = false
      const definition: PresetDefinition = actualPresetDefinition(plain())
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
          logger.warn(`register actual preset failed: ${detail}`)
        })
      return () => {
        disposed = true
        if (unregister !== undefined) void unregister()
      }
    }, 'actual: register actual preset')
  })
}
