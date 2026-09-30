/**
 * 写确认策略：接入 DSH 官方审批体系（`ctx.approval`，dsh-user-approval），
 * 而非自建门禁——是否弹窗完全由会话的审批策略决定：
 *
 * - `ask`（默认）→ 返回 `{kind:'ask'}`，经官方桥接弹审批窗；
 * - `never`（完全权限预设 danger-full-access 的配对值 / 无人值守）→ 直接放行，
 *   「完全权限模式下全部自动通过」；
 * - 审批服务缺席或调用无会话 → 放行（绝不让 ask 静默降级成拒绝）。
 *
 * 判定顺序（纯函数，单测钉住）：
 * 1. `confirmWrites=false` → 全部交还瀑布；
 * 2. 非本插件工具 → 交还瀑布；
 * 3. 整工具在 `alwaysAsk`（外发/文件系统面）→ 写类；
 * 4. 有 `action`：在 `readActions` 白名单 → 读类，否则写类；
 * 5. 无 `action`：工具名在 `readTools` → 读类，否则写类（宁多问不漏放）；
 * 6. 写类再按有效审批策略决定 ask / 放行。
 * @module @dsh-plus/siyuan-tools/policy
 */
import type { Context } from '@deepseek-ai/cordis'

import type { SiyuanToolsConfig } from './config.ts'

/** 策略判定输入（集合化，便于每调用 O(1) 判定）。 */
export interface PolicySettings {
  confirmWrites: boolean
  readActions: Set<string>
  alwaysAsk: Set<string>
  readTools: Set<string>
}

/** 判定结论；undefined = 非本插件工具，放行给后续瀑布。 */
export type PolicyVerdict = 'allow' | 'ask' | undefined

/** 由插件配置构造判定集合。 */
export function policySettingsOf(config: SiyuanToolsConfig): PolicySettings {
  return {
    confirmWrites: config.confirmWrites,
    readActions: new Set(config.readActions),
    alwaysAsk: new Set(config.alwaysAsk),
    readTools: new Set(config.readTools),
  }
}

/** 读取模型入参中的 action 字符串（缺失/类型不符返回 undefined）。 */
export function actionOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const action = (args as { action?: unknown }).action
  return typeof action === 'string' ? action : undefined
}

/**
 * 纯判定：给定裸工具名（undefined = 非本插件）与入参得出结论。
 * @param rawName - 去除前缀后的 SiYuan 能力名。
 * @param args - 模型入参。
 * @param settings - 判定集合。
 */
export function classifyPolicy(
  rawName: string | undefined,
  args: unknown,
  settings: PolicySettings,
): PolicyVerdict {
  if (rawName === undefined) return undefined
  if (settings.alwaysAsk.has(rawName)) return 'ask'
  const action = actionOf(args)
  if (action === undefined) return settings.readTools.has(rawName) ? 'allow' : 'ask'
  return settings.readActions.has(action) ? 'allow' : 'ask'
}

/** 生成审批理由（简短、含目标动作与确认原因）。 */
export function askReason(rawName: string, args: unknown, settings: PolicySettings): string {
  const action = actionOf(args)
  const cause = settings.alwaysAsk.has(rawName)
    ? '外发/包管理/文件系统类操作'
    : action === undefined
      ? '未标注为只读的操作'
      : '写操作'
  const suffix = action === undefined ? '' : ` action=${action}`
  return `确认 SiYuan ${rawName}${suffix}：${cause}，通过审批后执行。`
}

/** 审批窗展示文案（en 必填，zh 供本地化界面直取）。 */
export function askDisplayReason(
  rawName: string,
  args: unknown,
  settings: PolicySettings,
): { readonly en: string; readonly zh: string } {
  const action = actionOf(args)
  const suffix = action === undefined ? '' : ` ${action}`
  const cause = settings.alwaysAsk.has(rawName)
    ? 'external / package / filesystem operation'
    : 'write operation'
  return {
    en: `SiYuan ${rawName}${suffix}: ${cause} — approve to run it once.`,
    zh: `思源笔记 ${rawName}${suffix}：${settings.alwaysAsk.has(rawName) ? '外发/包管理/文件系统类操作' : '写操作'}，批准后执行一次。`,
  }
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
    if (classifyPolicy(rawName, exec.arguments, settings) !== 'ask') return next()
    if (effectiveApprovalPolicy(ctx, exec) !== 'ask') return next()
    return {
      kind: 'ask',
      reason: askReason(rawName, exec.arguments, settings),
      displayReason: askDisplayReason(rawName, exec.arguments, settings),
    }
  })
}
