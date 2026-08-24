/**
 * dsh 插件：功能开关管理器。
 * 按功能组开关官方插件与 dsh-plus 自研插件：官方子代理相关行（delegation 组）
 * 合并显示为「子代理与工作流」一个开关；核心插件经封闭目录隔离，不可关闭。
 *
 * 双平面机制：
 * - host 平面（组合树行）→ profile 用户 patch 层管理条目，watchUserPatches
 *   热应用（即时生效）；
 * - preset 平面（agent 预设行）→ 托管预设副本（dsh-plus-toggles），新会话生效。
 * 所有写入先备份后原子落盘，验证失败自动回滚备份。
 * @module @dsh-plus/feature-toggle
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, type FeatureToggleConfig } from './config.ts'
import { FeatureToggleEngine } from './engine.ts'
import { registerStateApi } from './state-api.ts'

export const name = 'dsh-plus-feature-toggle'

export const inject = ['settings', 'loader'] as const

export * from './catalog.ts'
export type { EngineState, PresetPointerState } from './engine.ts'
export { MANAGED_PRESET_ID } from './ns.ts'
export { Config, FeatureToggleEngine }

export function apply(ctx: Context, config: FeatureToggleConfig): void {
  const engine = new FeatureToggleEngine(ctx, config)
  ctx.plugin(engine)
  ctx.inject(['webServer'], (webCtx) => {
    registerStateApi(webCtx, engine)
  })
}
