/**
 * 配置单一事实源：cordis 行级 Config（组合默认值）与 settings namespace
 * （用户层，$DSH_HOME/settings.yaml 热生效）共用同一 schemastery schema。
 * @module usage-panel/config
 */
import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间（字面量即合法命名空间，0.1.2-alpha.2 起编译期校验）。 */
export const SETTINGS_NS = NS_LITERAL

/** 每百万 token 单价条目（模型维度；0 = 免费）。 */
// biome-ignore lint/suspicious/noExplicitAny: dts 可移植性——嵌套 schema 的精确类型经 TypeT 消费，显式断掉 cosmokit 推断链
const PriceEntrySchema: any = z.object({
  provider: z.string().min(1).description('provider 路由键（与 llm 路由一致）').default(''),
  model: z.string().min(1).description('provider 内模型 id').default(''),
  inputPerMtok: z.number().min(0).description('每 1M 输入 tokens 单价').default(0),
  outputPerMtok: z.number().min(0).description('每 1M 输出 tokens 单价').default(0),
  cacheReadPerMtok: z.number().min(0).description('每 1M 缓存读 tokens 单价').default(0),
  cacheWritePerMtok: z.number().min(0).description('每 1M 缓存写 tokens 单价').default(0),
})

export const Config = z.object({
  prices: z.array(PriceEntrySchema).description('价目表（手工或 models.dev 导入）').default([]),
  currency: z.string().min(1).description('费用货币单位展示码').default('CNY'),
  catalogProxy: z.string().description('models.dev 拉取代理（空 = 直连）').default(''),
})

export type UsagePanelConfig = Schemastery.TypeT<typeof Config>
