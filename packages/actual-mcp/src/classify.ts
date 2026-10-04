/**
 * 读/写判定（纯函数 + 默认表）。
 *
 * 这一层**不是**从 help 派生的：commander 不暴露任何「是否修改数据」的信号
 * （CLI 内部有 `{ mutates }`，但不进 help 文本）。因此默认表是显式维护的
 * 安全策略，且**未命中一律落「问」侧**——新增/改名动作默认需要确认，宁多问不漏放。
 * @module @dsh-plus/actual-mcp/classify
 */

/**
 * 视为「读」的 action 白名单。
 * 来源：逐条审阅本 CLI 全部动作（26.10.0）后只收纯查询类；`alwaysAsk` 优先于本表。
 */
export const DEFAULT_READ_ACTIONS: readonly string[] = [
  'balance',
  'common',
  'fields',
  'get-id',
  'list',
  'month',
  'months',
  'payee-rules',
  'run',
  'tables',
  'version',
]

/** 无 action 属性时按工具名判读的只读名单（本 CLI 的 `sync` 属写侧，故默认空）。 */
export const DEFAULT_READ_TOOLS: readonly string[] = []

/** 整工具强制确认名单（本 CLI 无此需求，保留配置位供部署方扩展）。 */
export const DEFAULT_ALWAYS_ASK: readonly string[] = []

/** 判定集合（每调用 O(1)）。 */
export interface ClassifySettings {
  readActions: ReadonlySet<string>
  alwaysAsk: ReadonlySet<string>
  readTools: ReadonlySet<string>
}

/** 由三个名单构造判定集合。 */
export function toSettings(lists: {
  readActions: readonly string[]
  alwaysAsk: readonly string[]
  readTools: readonly string[]
}): ClassifySettings {
  return {
    readActions: new Set(lists.readActions),
    alwaysAsk: new Set(lists.alwaysAsk),
    readTools: new Set(lists.readTools),
  }
}

/** 读取模型入参中的 action 字符串（缺失/类型不符返回 undefined）。 */
export function actionOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const action = (args as { action?: unknown }).action
  return typeof action === 'string' ? action : undefined
}

/**
 * CLI 自带的「预览不落盘」逃生门：`transactions import --dry-run` 明示
 * 只预览不导入，按读处理；其余动作没有等价的官方声明，一律按写处理。
 */
function isDryRunPreview(rawName: string, action: string, args: unknown): boolean {
  if (rawName !== 'transactions' || action !== 'import') return false
  return (args as { dryRun?: unknown }).dryRun === true
}

/**
 * 纯判定：给定工具名与模型入参得出结论。
 * @param rawName - 去除前缀后的能力名（工具名去 namePrefix）。
 * @param args - 模型入参。
 * @param settings - 判定集合。
 * @returns `allow` = 直接执行；`ask` = 经审批确认。
 */
export function classifyAction(
  rawName: string,
  args: unknown,
  settings: ClassifySettings,
): 'allow' | 'ask' {
  if (settings.alwaysAsk.has(rawName)) return 'ask'
  const action = actionOf(args)
  if (action === undefined) return settings.readTools.has(rawName) ? 'allow' : 'ask'
  if (isDryRunPreview(rawName, action, args)) return 'allow'
  return settings.readActions.has(action) ? 'allow' : 'ask'
}

/** 审批窗展示文案（en 必填，zh 供本地化界面直取）。 */
export function askDisplayReason(
  rawName: string,
  args: unknown,
  settings: ClassifySettings,
): { readonly en: string; readonly zh: string } {
  const action = actionOf(args)
  const suffix = action === undefined ? '' : ` ${action}`
  const cause = settings.alwaysAsk.has(rawName) ? 'bulk-confirmation operation' : 'write operation'
  const zhCause = settings.alwaysAsk.has(rawName) ? '整表强制确认类操作' : '写操作'
  return {
    en: `Actual ${rawName}${suffix}: ${cause} — approve to run it once.`,
    zh: `Actual Budget ${rawName}${suffix}：${zhCause}，批准后执行一次。`,
  }
}
