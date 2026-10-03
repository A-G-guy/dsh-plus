/**
 * /reload 的状态与文案单一来源：命令面（会话直渲）与 HTTP 面（设置行）共用，
 * 保证同一状态在两条入口的措辞与字段一致。
 * 纯函数式组织（全部依赖注入），测试直接驱动，不经 cordis。
 * @module reload/report
 */
import {
  type InProcessCapabilities,
  type InProcessOutcome,
  unsupportedReasons,
} from './inprocess.ts'
import type { PreflightResult } from './preflight.ts'

export type ApplyStatus = 'applied' | 'unsupported' | 'failed' | 'agents-running'

export interface ApplyReport {
  status: ApplyStatus
  /** 面向用户的多行文本。 */
  text: string
  /** 既有 inactive 条目诊断与降级说明。 */
  warnings: string[]
  /** 启动后被改动、只能重启生效的包名。 */
  pendingRestart: string[]
  capabilities: InProcessCapabilities
  runningAgents: number
}

export interface ApplyDeps {
  capabilities: () => InProcessCapabilities
  /** 执行进程内重载（接线好的核心调用）。 */
  run: () => Promise<InProcessOutcome>
  /** 启动后被改动、需重启才生效的包名；实现侧保证不 reject。 */
  pendingRestart: () => Promise<string[]>
  runningAgents: () => number
}

/** status 报告只需要事实读取，不需要 apply 入口。 */
export interface StatusDeps {
  capabilities: () => InProcessCapabilities
  /** 启动后被改动、需重启才生效的包名；实现侧保证不 reject。 */
  pendingRestart: () => Promise<string[]>
  runningAgents: () => number
  preflight: () => Promise<PreflightResult>
  schedulerState: () => string
  bootId: string
}

/** 生效说明（进程内重载覆盖的范围）。 */
const APPLIED_HEAD =
  '已即时生效：profile 组合层已重新对账（行启停、行配置、组合包选择、settings）。'
/** 需重启时的替代路径说明。 */
const RESTART_HINT =
  '执行 /reload restart 重启服务（设置页「重启服务」同效），或用 dshctl restart-prod。'

function renderWarnings(warnings: readonly string[]): string[] {
  if (warnings.length === 0) return []
  return ['诊断：', ...warnings.map((line) => `- ${line}`)]
}

function renderPendingApplied(
  pendingRestart: readonly string[],
  warnings: readonly string[],
): string {
  const lines = [APPLIED_HEAD]
  if (pendingRestart.length === 0) lines.push('没有检测到需要重启的变更。')
  else {
    lines.push(
      '以下包的本体在进程启动后被改动；它们位于 node_modules，上游热重载不替换其模块，需重启才生效：',
      ...pendingRestart.map((name) => `- ${name}`),
      RESTART_HINT,
    )
  }
  lines.push(...renderWarnings(warnings))
  return lines.join('\n')
}

function renderAgentsRunning(count: number): string {
  return [
    `检测到 ${count} 个会话正在运行；进程内重载会重建插件行并打断它们。`,
    '等待当前响应结束后重试，或执行 /reload force 强制执行（设置页「强制执行」同效）。',
  ].join('\n')
}

function renderFailed(message: string): string {
  return [
    `重载失败：${message}`,
    '磁盘上的组合层未被修改时可重试 /reload；也可执行 /reload restart 重启回退到磁盘组合。',
  ].join('\n')
}

function renderUnsupported(reasons: readonly string[]): string {
  return ['当前环境不支持进程内重载：', ...reasons.map((reason) => `- ${reason}`)].join('\n')
}

/**
 * 执行一次进程内重载并生成报告。
 * @param deps - 注入的能力位、执行入口与状态读取。
 * @param options - `force` 跳过运行中会话防线（与 pi 的「等当前响应结束」语义对应）。
 * @returns 面向两条入口的统一报告。
 */
export async function applyReport(
  deps: ApplyDeps,
  options: { force: boolean },
): Promise<ApplyReport> {
  const capabilities = deps.capabilities()
  const runningAgents = deps.runningAgents()
  const base = { warnings: [], pendingRestart: [], capabilities, runningAgents }

  const reasons = unsupportedReasons(capabilities)
  if (reasons.length > 0) {
    return { ...base, status: 'unsupported', text: renderUnsupported(reasons) }
  }
  if (runningAgents > 0 && !options.force) {
    return { ...base, status: 'agents-running', text: renderAgentsRunning(runningAgents) }
  }

  const outcome = await deps.run()
  if (outcome.kind === 'unsupported') {
    return { ...base, status: 'unsupported', text: renderUnsupported(outcome.reasons) }
  }
  if (outcome.kind === 'failed') {
    return { ...base, status: 'failed', text: renderFailed(outcome.message) }
  }
  const pendingRestart = await deps.pendingRestart()
  return {
    ...base,
    status: 'applied',
    warnings: outcome.warnings,
    pendingRestart,
    text: renderPendingApplied(pendingRestart, outcome.warnings),
  }
}

/** 能力位速览（status 报告用）。 */
function renderCapabilities(capabilities: InProcessCapabilities): string {
  const mark = (available: boolean, name: string): string => `${name} ${available ? '✓' : '✗'}`
  return [
    mark(capabilities.profile, 'profile'),
    mark(capabilities.hmr, 'hmr'),
    mark(capabilities.pluginPackages, 'pluginPackages'),
  ].join(' / ')
}

/**
 * `/reload status` 文本：进程内重载可用性、重启通道预检、调度状态与待重启清单。
 * @param deps - 状态来源集合。
 * @returns 多行文本。
 */
export async function statusText(deps: StatusDeps): Promise<string> {
  const capabilities = deps.capabilities()
  const reasons = unsupportedReasons(capabilities)
  const lines = [
    `进程内重载: ${reasons.length === 0 ? '可用' : '不可用'}（${renderCapabilities(capabilities)}）`,
    ...reasons.map((reason) => `- ${reason}`),
  ]

  const preflight = await deps.preflight()
  lines.push(`重启通道: ${preflight.ok ? '预检通过' : '预检未通过'}`)
  for (const reason of preflight.reasons) lines.push(`- ${reason}`)

  const pendingRestart = await deps.pendingRestart()
  lines.push(
    `调度状态: ${deps.schedulerState()}；运行中会话: ${deps.runningAgents()}；bootId: ${deps.bootId}`,
  )
  lines.push(`待重启生效: ${pendingRestart.length === 0 ? '无' : pendingRestart.join('、')}`)
  return lines.join('\n')
}
