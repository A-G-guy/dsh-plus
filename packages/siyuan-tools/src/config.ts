/**
 * 子插件配置：安全策略与执行参数（预设定义由主插件按其配置下发本行）。
 * @module @dsh-plus/siyuan-tools/config
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_ALWAYS_ASK, DEFAULT_READ_ACTIONS, DEFAULT_READ_TOOLS } from '@dsh-plus/siyuan'

export const Config = z.object({
  toolCallTimeoutMs: z.number().description('单次工具调用超时（毫秒）').default(60_000),
  confirmWrites: z
    .boolean()
    .description('非读操作返回 ask 决策（审批弹窗；审批缺席时降级为拒绝）')
    .default(true),
  readActions: z
    .array(z.string())
    .description('读动作白名单（alwaysAsk 优先）')
    .default(DEFAULT_READ_ACTIONS),
  alwaysAsk: z.array(z.string()).description('整工具强制确认名单').default(DEFAULT_ALWAYS_ASK),
  readTools: z
    .array(z.string())
    .description('无 action 属性时按工具名判读的名单')
    .default(DEFAULT_READ_TOOLS),
  namePrefix: z.string().description('模型可见工具名前缀（空 = 用原名）').default(''),
})

export type SiyuanToolsConfig = Schemastery.TypeT<typeof Config>
