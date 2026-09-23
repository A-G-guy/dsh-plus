/**
 * 配置单一事实源：cordis 行级 Config（组合默认值）与 settings namespace
 * （用户层，$DSH_HOME/settings.yaml 热生效）共用同一 schemastery schema。
 * @module usage-panel/config
 */
import z from '@deepseek-ai/schemastery'
import type { UnwrapVolatile } from '@dsh-plus/shared'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'
// 价目 schema 与 PriceEntry 类型同源在 pricing.ts（避免两处维护漂移）。
import { PriceEntrySchema } from './pricing.ts'

/** settings 命名空间（字面量即合法命名空间，0.1.2-alpha.2 起编译期校验）。 */
export const SETTINGS_NS = NS_LITERAL

// 0.1.7：全字段 `.volatile()`——条目进入 settings describe 视图（卡片可读写），
// loader 原位提交活动引用，current() 现取即热。
export const Config = z.object({
  prices: z
    .array(PriceEntrySchema)
    .description('价目表（手工或 models.dev 导入）')
    .default([])
    .volatile(),
  currency: z.string().min(1).description('费用货币单位展示码').default('CNY').volatile(),
  catalogProxy: z.string().description('models.dev 拉取代理（空 = 直连）').default('').volatile(),
  autoSyncMinutes: z
    .number()
    .min(0)
    .max(1440)
    .description('历史会话自动增量同步间隔（分钟，0 = 仅启动时同步一次）')
    .default(30)
    .volatile(),
  catalogRefreshHours: z
    .number()
    .min(0)
    .max(720)
    .description('models.dev 目录自动刷新间隔（小时，0 = 仅启动时拉取一次）')
    .default(24)
    .volatile(),
})

/** 活动字段形态（0.1.7 loader 解析产物：volatile 字段为活动引用）。 */
export type UsagePanelConfigFields = Schemastery.TypeT<typeof Config>
/** 平面配置形态（消费面的读取形态，由活动引用解包得到）。 */
export type UsagePanelConfig = UnwrapVolatile<UsagePanelConfigFields>
