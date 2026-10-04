/**
 * 子插件配置：安全策略与执行参数（预设定义由主插件按其配置下发本行）。
 * @module @dsh-plus/actual-tools/config
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_ALWAYS_ASK, DEFAULT_READ_ACTIONS, DEFAULT_READ_TOOLS } from '@dsh-plus/actual'

export const Config = z.object({
  toolCallTimeoutMs: z.number().description('单次工具调用超时（毫秒）').default(60_000),
  confirmWrites: z
    .boolean()
    .description('非读操作经 DSH 审批策略确认（policy=ask 弹窗；never/完全权限模式自动通过）')
    .default(true),
  readActions: z
    .array(z.string())
    .description('读动作白名单（alwaysAsk 优先；未命中一律落「问」侧）')
    .default([...DEFAULT_READ_ACTIONS]),
  alwaysAsk: z
    .array(z.string())
    .description('整工具强制确认名单（裸族名，优先于 readActions）')
    .default([...DEFAULT_ALWAYS_ASK]),
  readTools: z
    .array(z.string())
    .description('无 action 属性时按族名判读的只读名单')
    .default([...DEFAULT_READ_TOOLS]),
  namePrefix: z.string().description('模型可见工具名前缀（空 = 用裸族名）').default('actual_'),
})

export type ActualToolsConfig = Schemastery.TypeT<typeof Config>
