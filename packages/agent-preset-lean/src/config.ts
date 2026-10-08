/**
 * 插件配置（schemastery）：显示面与 persona 文本外部化，部署方可在 profile 的
 * cordis.patch.yml 覆盖单个字段（patch 层按行整体替换，需写全字段）。
 *
 * 预设 id 固定为 `lean`（注册表身份，不开放覆盖——改 id 等于换预设，
 * default/selectedDefault 等引用都会落空）。
 * @module @dsh-plus/agent-preset-lean/config
 */
import z from '@deepseek-ai/schemastery'

import { LEAN_PERSONA_PREFIX } from './prompt.ts'

export const Config = z.object({
  enabled: z
    .boolean()
    .description('总开关（false = 不注册 lean 预设，等价插件未安装）')
    .default(true),
  name: z.string().description('预设显示名（设置 → Agent 预设卡片标题）').default('精简模式'),
  description: z
    .string()
    .description('预设说明（设置 → Agent 预设卡片描述）')
    .default(
      '精简编码预设：官方核心工具子集（shell/文件/联网/技能/待办/提问/计划/交付），去掉委派与编排类工具。',
    ),
  order: z
    .number()
    .description('预设显示次序（官方 standard=1 / ptc=2 / minimal=3 / cordis=4）')
    .default(5),
  personaPrefix: z
    .string()
    .description('persona 前缀（本预设唯一的自有提示词文本）')
    .default(LEAN_PERSONA_PREFIX),
})

export type AgentPresetLeanConfig = Schemastery.TypeT<typeof Config>
