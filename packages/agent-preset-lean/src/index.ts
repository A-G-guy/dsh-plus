/**
 * dsh 服务插件：把「精简模式」注册为官方 agent preset（id=`lean`）。
 *
 * 预设声明经 `ctx.agentPresets.register()` 注册（官方 preset registry 是唯一
 * 读取方），出现在设置 → Agent 预设的名单里，可被会话选择。
 *
 * 预设语义：官方 `standard` 预设的行镜像子集——保留 shell（bash，Windows 上
 * 由 pwsh 顶替）、文件读写、后台任务、联网检索、技能、待办、提问、计划模式、
 * 交付与压缩；去掉委派与编排类大件（subagent/fork/workflow/ralph）、goal、
 * schedule、glob/grep 与插件管理工具，以降低工具定义与提示词的固定开销。
 * 每条保留行的 id/name/config 与上游逐字一致（见 definition.ts）。
 *
 * 设计取舍：
 * - 独立插件而非 cordis.patch.yml 里的裸 `@deepseek-ai/dsh-agent-preset`
 *   行：便于纳入本仓的构建/测试/文档体系，并把显示面与 persona 开放为可覆盖配置；
 * - 惰性 inject `agentPresets`：服务缺席的 profile（如 headless）里本行
 *   照常 active、只是不注册（等价插件缺席），绝不因硬 inject 永久 pending
 *   拖垮 boot（同 boot-retry 的教训）；
 * - `register()` 在 effect 内后台完成、不阻塞 apply：注册会同步挂载预设
 *   子树并等待其激活，await 在本行激活内可能与 Host 树推进互锁；失败仅
 *   记 warn（重名等由注册表负责诊断），不使 boot 失败。
 * @module @dsh-plus/agent-preset-lean
 */
import type { Context } from '@deepseek-ai/cordis'

import { type AgentPresetLeanConfig, Config } from './config.ts'
import { leanPresetDefinition } from './definition.ts'

export const name = 'dsh-plus-agent-preset-lean'

/** 无硬 inject：agentPresets 经 apply 内惰性 inject 接线（缺席即空转）。 */
export const inject = [] as const

export {
  DROPPED_ROWS,
  LEAN_PRESET_ID,
  leanPresetDefinition,
  resolvePersonaPrefix,
} from './definition.ts'
export { LEAN_PERSONA_PREFIX, PLAN_MODE_SECTION } from './prompt.ts'
export type { AgentPresetLeanConfig }
export { Config }

/**
 * 注册 lean 预设；卸载时注销。
 *
 * 注册与后续注销都在 effect 生命周期内完成：fiber 早于注册完成被卸下时，
 * `disposed` 标记保证晚到的 disposer 仍被调用，不泄漏预设子树。
 * @param ctx - 宿主上下文。
 * @param config - 已验证的插件配置。
 */
export function apply(ctx: Context, config: AgentPresetLeanConfig): void {
  if (config.enabled !== true) return
  const logger = ctx.logger('agent-preset-lean')

  ctx.inject(['agentPresets'], (scope) => {
    scope.effect(() => {
      let unregister: (() => Promise<void>) | undefined
      let disposed = false
      void scope.agentPresets
        .register(leanPresetDefinition(config))
        .then((dispose) => {
          if (disposed) {
            void dispose()
            return
          }
          unregister = dispose
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          logger.warn(`register lean preset failed: ${detail}`)
        })
      return () => {
        disposed = true
        if (unregister !== undefined) void unregister()
      }
    }, 'agent-preset-lean: register lean preset')
  })
}
