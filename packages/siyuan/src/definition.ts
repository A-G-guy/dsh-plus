/**
 * 思源笔记预设声明组装：persona（完整系统提示词）+ 子插件行（工具暴露
 * 与安全策略下发）——「主插件协调组装子插件」的落点。
 * @module @dsh-plus/siyuan/definition
 */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import type { SiyuanConfig } from './config.ts'
import { DEFAULT_PERSONA_PREFIX } from './prompt.ts'

/** 预设注册表身份（改 id 等于换预设，default 等引用会落空）。 */
export const SIYUAN_PRESET_ID = 'siyuan'

/** 生效的 persona 文本：显式配置优先，空串回落内置思源优化版。 */
export function resolvePersonaPrefix(config: SiyuanConfig): string {
  return config.personaPrefix.trim() === '' ? DEFAULT_PERSONA_PREFIX : config.personaPrefix
}

/**
 * 由主插件配置拼出预设声明。
 *
 * 只挂 persona 与 siyuan-tools 两行：不挂任何官方工具行（bash/fs/skill/
 * todo/web/subagent/plan/compaction/ask-user 等），预设的工具目录即
 * 自动派生的思源能力集；agent 框架（循环/会话/审批/持久化）在宿主侧。
 */
export function siyuanPresetDefinition(config: SiyuanConfig): PresetDefinition {
  return {
    id: SIYUAN_PRESET_ID,
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
        id: 'siyuan-tools',
        name: '@dsh-plus/siyuan-tools',
        config: {
          toolCallTimeoutMs: config.toolCallTimeoutMs,
          confirmWrites: config.confirmWrites,
          readActions: [...config.readActions],
          alwaysAsk: [...config.alwaysAsk],
          readTools: [...config.readTools],
          namePrefix: config.namePrefix,
        },
      },
    ],
  }
}
