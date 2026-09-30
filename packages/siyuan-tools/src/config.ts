/**
 * 子插件配置：安全策略与执行参数（预设定义由主插件按其配置下发本行）。
 * @module @dsh-plus/siyuan-tools/config
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_ALWAYS_ASK,
  DEFAULT_READ_ACTIONS,
  DEFAULT_READ_TOOLS,
  DEFAULT_SNAPSHOT_BEFORE_WRITE,
  DEFAULT_SNAPSHOT_FAILURE,
} from '@dsh-plus/siyuan'

export const Config = z.object({
  toolCallTimeoutMs: z.number().description('单次工具调用超时（毫秒）').default(60_000),
  confirmWrites: z
    .boolean()
    .description('非读操作经 DSH 审批策略确认（policy=ask 弹窗；never/完全权限模式自动通过）')
    .default(true),
  snapshotBeforeWrite: z
    .boolean()
    .description('首个本地写操作前创建数据历史快照（每会话一次，对齐思源内置 agent）')
    .default(DEFAULT_SNAPSHOT_BEFORE_WRITE),
  snapshotFailure: z
    .union(['abort', 'warn'])
    .description('快照失败处置：abort = 中止写入（官方行为）；warn = 放行但记录告警')
    .default(DEFAULT_SNAPSHOT_FAILURE),
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
