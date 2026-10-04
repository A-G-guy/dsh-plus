/**
 * Actual Budget 预设声明组装：persona（完整系统提示词）+ 子插件行（工具暴露
 * 与安全策略下发）——「主插件协调组装子插件」的落点。
 * @module @dsh-plus/actual/definition
 */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import type { ActualConfig } from './config.ts'
import { DEFAULT_PERSONA_PREFIX } from './prompt.ts'

/** 预设注册表身份（改 id 等于换预设，default 等引用会落空）。 */
export const ACTUAL_PRESET_ID = 'actual'

/** 生效的 persona 文本：显式配置优先，空串回落内置 Actual 优化版。 */
export function resolvePersonaPrefix(config: ActualConfig): string {
  return config.personaPrefix.trim() === '' ? DEFAULT_PERSONA_PREFIX : config.personaPrefix
}

/**
 * 由主插件配置拼出预设声明。
 *
 * 操作面只挂 actual-tools 一行（Actual CLI 派生能力）：不挂任何官方操作类
 * 工具行（bash/fs/edit/write/skill/subagent 等），agent 框架（循环/会话/
 * 审批/持久化）在宿主侧；`auxTools` 时另挂三行**辅助**工具（web 检索、
 * 结构化提问、待办跟踪）——均不改动预算数据，不扩大操作范围。
 *
 * 格式一（MCP 服务）不在此声明中出现：它是可移植件，由主插件在进程内挂载
 * 以派生本行工具，模型面看不到额外入口。
 */
export function actualPresetDefinition(config: ActualConfig): PresetDefinition {
  return {
    id: ACTUAL_PRESET_ID,
    name: config.name,
    description: config.description,
    order: config.order,
    plugins: [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: {
          prefix: resolvePersonaPrefix(config),
          complete: true,
          includeRuntimeContext: config.includeRuntimeContext,
        },
      },
      {
        id: 'actual-tools',
        name: '@dsh-plus/actual-tools',
        config: {
          toolCallTimeoutMs: config.toolCallTimeoutMs,
          confirmWrites: config.confirmWrites,
          readActions: [...config.readActions],
          alwaysAsk: [...config.alwaysAsk],
          readTools: [...config.readTools],
          namePrefix: config.namePrefix,
        },
      },
      ...(config.auxTools
        ? [
            {
              id: 'tool-web',
              name: '@deepseek-ai/dsh-tool-web',
              config: { fetch: true, searchTimeoutMs: 60_000 },
            },
            { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
            {
              id: 'tool-todo',
              name: '@deepseek-ai/dsh-tool-todo',
              config: { allowParallelInProgress: true },
            },
          ]
        : []),
    ],
  }
}
