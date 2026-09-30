/**
 * 写确认策略：对齐思源笔记内置 agent 行为（读操作免确认、写操作经审批
 * 弹窗确认），落点为 `tools/pre-execute` 瀑布（agent 作用域）。
 *
 * 判定顺序（纯函数，单测钉住）：
 * 1. 整工具在 `alwaysAsk`（外发/文件系统面）→ ask；
 * 2. 有 `action`：在 `readActions` 白名单 → allow，否则 ask；
 * 3. 无 `action`：工具名在 `readTools` → allow，否则 ask（宁多问不漏放）。
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
function actionOf(args: unknown): string | undefined {
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
    if (classifyPolicy(rawName, exec.arguments, settings) === 'ask') {
      return { kind: 'ask', reason: askReason(rawName, exec.arguments, settings) }
    }
    return next()
  })
}
