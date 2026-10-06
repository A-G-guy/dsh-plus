/**
 * dsh 服务插件：把「纯聊天模式」注册为官方 agent preset（id=`chat`）。
 *
 * 预设声明经 `ctx.agentPresets.register()` 注册（官方 preset registry 是唯一
 * 读取方；`$DSH_HOME/.agent-presets/` 目录已无读取方），出现在设置 →
 * Agent 预设的名单里，可被会话选择。
 *
 * 预设语义：仅一行 `persona`，prefix 为空且 `complete: true` —— 系统提示词即
 * 该行本身，工具目录为空、无 skill 目录、不注入运行时上下文；会话/对话主流程不变。
 *
 * 设计取舍：
 * - 独立插件而非 cordis.patch.yml 里的裸 `@deepseek-ai/dsh-agent-preset`
 *   行：便于纳入本仓的构建/测试/文档体系，并把显示面（name/description）
 *   开放为可覆盖配置；
 * - 惰性 inject `agentPresets`：服务缺席的 profile（如 headless）里本行
 *   照常 active、只是不注册（等价插件缺席），绝不因硬 inject 永久 pending
 *   拖垮 boot（同 boot-retry 的教训）；
 * - `register()` 在 effect 内后台完成、不阻塞 apply：注册会同步挂载预设
 *   子树并等待其激活，await 在本行激活内可能与 Host 树推进互锁；失败仅
 *   记 warn（重名等由注册表负责诊断），不使 boot 失败。
 * @module @dsh-plus/agent-preset-chat
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import { type AgentPresetChatConfig, Config } from './config.ts'

export const name = 'dsh-plus-agent-preset-chat'

/** 无硬 inject：agentPresets 经 apply 内惰性 inject 接线（缺席即空转）。 */
export const inject = [] as const

export type { AgentPresetChatConfig }
export { Config }

/**
 * chat 预设的子插件声明：唯一一行 persona。
 *
 * - `prefix: ''` + `complete: true`：该行即完整系统提示词，全局身份、
 *   Web 定向与工具指引不再追加任何文本；
 * - `includeRuntimeContext: false`：不注入运行时上下文快照；
 * - 不声明任何工具/skill 行 → 模型拿到空工具目录。
 */
const CHAT_PLUGINS: PresetDefinition['plugins'] = [
  {
    id: 'persona',
    name: '@deepseek-ai/dsh-persona',
    config: {
      prefix: '',
      complete: true,
      includeRuntimeContext: false,
    },
  },
]

/**
 * 由配置拼出注册表声明。
 * @param config - 已验证的插件配置。
 * @returns id 固定为 `chat` 的预设声明。
 */
export function chatPresetDefinition(config: AgentPresetChatConfig): PresetDefinition {
  return {
    id: 'chat',
    name: config.name,
    description: config.description,
    plugins: CHAT_PLUGINS,
  }
}

/**
 * 注册 chat 预设；卸载时注销。
 *
 * 注册与后续注销都在 effect 生命周期内完成：fiber 早于注册完成被卸下时，
 * `disposed` 标记保证晚到的 disposer 仍被调用，不泄漏预设子树。
 * @param ctx - 宿主上下文。
 * @param config - 已验证的插件配置。
 */
export function apply(ctx: Context, config: AgentPresetChatConfig): void {
  if (config.enabled !== true) return
  const logger = ctx.logger('agent-preset-chat')

  ctx.inject(['agentPresets'], (scope) => {
    scope.effect(() => {
      let unregister: (() => Promise<void>) | undefined
      let disposed = false
      void scope.agentPresets
        .register(chatPresetDefinition(config))
        .then((dispose) => {
          if (disposed) {
            void dispose()
            return
          }
          unregister = dispose
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          logger.warn(`register chat preset failed: ${detail}`)
        })
      return () => {
        disposed = true
        if (unregister !== undefined) void unregister()
      }
    }, 'agent-preset-chat: register chat preset')
  })
}
