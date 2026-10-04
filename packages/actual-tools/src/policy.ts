/**
 * 写确认策略：接入 DSH 官方审批体系（`ctx.approval`，dsh-user-approval），
 * 而非自建门禁——是否弹窗完全由会话的审批策略决定：
 *
 * - `ask`（默认）→ 返回 `{kind:'ask'}`，经官方桥接弹审批窗；
 * - `never`（完全权限预设 danger-full-access 的配对值 / 无人值守）→ 直接放行，
 *   「完全权限模式下全部自动通过」；
 * - 审批服务缺席或调用无会话 → 放行（绝不让 ask 静默降级成拒绝）。
 *
 * 读/写判定本身在 `@dsh-plus/actual-mcp` 的 `classifyAction`（纯函数、单测钉住）：
 * 命中 `readActions` 才算读，未命中一律落「问」侧。
 * @module @dsh-plus/actual-tools/policy
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  actionOf,
  askDisplayReason,
  type ClassifySettings,
  classifyAction,
  toSettings,
} from '@dsh-plus/actual'

import type { ActualToolsConfig } from './config.ts'

/** 判定结论；undefined = 非本插件工具，放行给后续瀑布。 */
export type PolicyVerdict = 'allow' | 'ask' | undefined

/** 本插件的策略设置 = 判定集合 + 总开关（`ClassifySettings` 只承载纯判定）。 */
export interface PolicySettings {
  confirmWrites: boolean
  classify: ClassifySettings
}

/** 由插件配置构造策略设置。 */
export function policySettingsOf(config: ActualToolsConfig): PolicySettings {
  return {
    confirmWrites: config.confirmWrites,
    classify: toSettings({
      readActions: config.readActions,
      alwaysAsk: config.alwaysAsk,
      readTools: config.readTools,
    }),
  }
}

/** 生成审批理由（简短、含目标动作与确认原因）。 */
export function askReason(rawName: string, args: unknown, settings: ClassifySettings): string {
  const action = actionOf(args)
  const suffix = action === undefined ? '' : ` action=${action}`
  const cause = settings.alwaysAsk.has(rawName) ? '整表强制确认类操作' : '写操作'
  return `确认 Actual ${rawName}${suffix}：${cause}，通过审批后执行。`
}

/**
 * 结构化审批接缝：只取判定所需字段（`ctx.get('approval')`），不引入平台包
 * 类型依赖——缺服务/缺方法一律视为「无审批通道」。
 */
export interface ApprovalSeam {
  config?: { policy?: unknown } | undefined
  overrideOf?: (session: unknown) => unknown
}

/** DSH 审批策略词汇。 */
export type ApprovalPolicy = 'ask' | 'never'

/**
 * 会话的有效审批策略：session 覆盖 → 服务配置默认 → `'ask'`。
 * 返回 undefined = 无审批服务或调用无会话（官方 ask 在此会静默拒绝，本插件改为放行）。
 */
export function effectiveApprovalPolicy(ctx: Context, exec: unknown): ApprovalPolicy | undefined {
  const approval = ctx.get('approval') as ApprovalSeam | undefined
  if (approval === undefined || typeof approval.overrideOf !== 'function') return undefined
  const session = (exec as { agent?: { session?: unknown } | undefined }).agent?.session
  if (session === undefined) return undefined
  const override = approval.overrideOf(session)
  if (override === 'ask' || override === 'never') return override
  const configured = approval.config?.policy
  if (configured === 'ask' || configured === 'never') return configured
  return 'ask'
}

/**
 * 注册 pre-execute 监听（随 fiber 释放）。
 * @param ctx - 插件上下文（预设作用域 → 只影响本预设 agent 的调用）。
 * @param settings - 判定集合。
 * @param rawNameOf - 公开工具名 → 裸能力名（非本插件返回 undefined）。
 */
export function registerPolicy(
  ctx: Context,
  settings: PolicySettings,
  rawNameOf: (publicName: string) => string | undefined,
): () => void {
  return ctx.on('tools/pre-execute', async (exec, next) => {
    if (!settings.confirmWrites) return next()
    const rawName = rawNameOf(exec.name)
    if (rawName === undefined) return next()
    if (classifyAction(rawName, exec.arguments, settings.classify) !== 'ask') return next()
    if (effectiveApprovalPolicy(ctx, exec) !== 'ask') return next()
    return {
      kind: 'ask',
      reason: askReason(rawName, exec.arguments, settings.classify),
      displayReason: askDisplayReason(rawName, exec.arguments, settings.classify),
    }
  })
}
