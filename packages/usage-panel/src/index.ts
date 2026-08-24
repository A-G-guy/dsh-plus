/**
 * dsh 插件：用量统计面板。聚合全量会话日志的 token usage
 * （实时通道 session/event + 手动历史扫描），按日/模型出报表，
 * 可选配价目估算费用。服务经 ctx.usagePanel 暴露。
 * @module @dsh-plus/usage-panel
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type UsagePanelConfig } from './config.ts'
import { UsagePanelService } from './service.ts'

export const name = 'dsh-plus-usage-panel'

export const inject = ['sessions'] as const

export { Config }

declare module '@deepseek-ai/cordis' {
  interface Context {
    usagePanel: UsagePanelService
  }
}

export function apply(ctx: Context, config: UsagePanelConfig): void {
  ctx.plugin(UsagePanelService, config)
}

export type { PriceEntry, PriceTable } from './pricing.ts'
export { UsagePanelService } from './service.ts'
export type { UsageRow } from './usage-fold.ts'
