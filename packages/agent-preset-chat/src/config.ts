/**
 * 插件配置（schemastery）：显示面字段外部化，部署方可在 profile 的
 * cordis.patch.yml 覆盖单个字段（patch 层按行整体替换，需写全字段）。
 *
 * 预设 id 固定为 `chat`（注册表身份，不开放覆盖——改 id 等于换预设，
 * default/selectedDefault 等引用都会落空）。
 * @module @dsh-plus/agent-preset-chat/config
 */
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  enabled: z
    .boolean()
    .description('总开关（false = 不注册 chat 预设，等价插件未安装）')
    .default(true),
  name: z.string().description('预设显示名（设置 → Agent 预设卡片标题）').default('聊天模式'),
  description: z
    .string()
    .description('预设说明（设置 → Agent 预设卡片描述）')
    .default('纯对话模式：无工具调用、无 skill、无内置提示词，仅用于聊天。'),
})

export type AgentPresetChatConfig = Schemastery.TypeT<typeof Config>
