/**
 * dsh 插件：子代理独立模型配置（subagent / subagent_fork 等）。
 * 为子代理按 provider 名配置 LLM 提供商、模型与思考程度（reasoningEffort），
 * 或选择从主代理继承；`default` 条目可让 spawn/fork 共享同一路由。
 * 主代理显式选择的路由（官方 subagent-model-selection 的 model 字段）优先，
 * 本插件只补"未选择时的强制默认"。
 * 配置经 settings 用户层（$DSH_HOME/settings.yaml）持久化并热生效；
 * 配置 UI 位于 webui 设置-插件-插件配置（settings.plugin.item 卡片，
 * 模型目录经 host webServer 同源端点下发）。
 * @module @dsh-plus/subagent-model
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type SubagentModelConfig } from './config.ts'
import { SubagentModelService } from './service.ts'

export const name = 'dsh-plus-subagent-model'

export const inject = ['subagents', 'llm'] as const

export type {
  EntryConfig,
  InjectedOptions,
  SubagentModelConfig,
} from './config.ts'
export { SubagentModelService } from './service.ts'
export { Config }

export function apply(ctx: Context, config: SubagentModelConfig): void {
  ctx.plugin(SubagentModelService, config)
}
