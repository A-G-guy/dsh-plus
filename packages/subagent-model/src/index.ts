/**
 * dsh 插件：子代理独立模型配置（subagent / subagent_fork 等）。
 * 为子代理按 provider 名配置 LLM 提供商、模型与思考程度（reasoningEffort），
 * 或选择从主代理继承；只负责模型选定，其余参数（maxTokens/persona/toolFilter/
 * maxDepth 等）保持 dsh 原生行为。配置 UI 位于 webui 设置-插件-插件配置，
 * 持久化到 $DSH_HOME/settings.yaml 并热生效。
 * @module @dsh-custom/subagent-model
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type SubagentModelConfig } from './config.ts'
import { SubagentModelService } from './service.ts'

export const name = 'dsh-custom-subagent-model'

export const inject = ['subagents', 'llm'] as const

export { Config }

export type { EntryConfig, InjectedOptions, SubagentModelConfig } from './config.ts'
export { SubagentModelService } from './service.ts'

export function apply(ctx: Context, config: SubagentModelConfig): void {
  ctx.plugin(SubagentModelService, config)
}
