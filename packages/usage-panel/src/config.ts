/**
 * 配置单一事实源：cordis 行级 Config（组合默认值）与 settings namespace
 * （用户层，$DSH_HOME/settings.yaml 热生效）共用同一 schemastery schema。
 * @module usage-panel/config
 */
import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'
// 价目 schema 与 PriceEntry 类型同源在 pricing.ts（避免两处维护漂移）。
import { PriceEntrySchema } from './pricing.ts'

/** settings 命名空间（字面量即合法命名空间，0.1.2-alpha.2 起编译期校验）。 */
export const SETTINGS_NS = NS_LITERAL

export const Config = z.object({
  prices: z.array(PriceEntrySchema).description('价目表（手工或 models.dev 导入）').default([]),
  currency: z.string().min(1).description('费用货币单位展示码').default('CNY'),
  catalogProxy: z.string().description('models.dev 拉取代理（空 = 直连）').default(''),
  autoSyncMinutes: z
    .number()
    .min(0)
    .max(1440)
    .description('历史会话自动增量同步间隔（分钟，0 = 仅启动时同步一次）')
    .default(30),
  catalogRefreshHours: z
    .number()
    .min(0)
    .max(720)
    .description('models.dev 目录自动刷新间隔（小时，0 = 仅启动时拉取一次）')
    .default(24),
})

export type UsagePanelConfig = Schemastery.TypeT<typeof Config>
