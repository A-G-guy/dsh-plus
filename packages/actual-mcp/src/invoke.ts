/**
 * 能力条目 → CLI 调用（MCP 服务端与 DSH 兜底共用同一条执行链）。
 *
 * 调用级 help 优先取发现阶段的缓存，未采到时按需补采；参数完整性与「属性是否
 * 适用于该 action」都在此层显式报错——并集 schema 下模型很容易把 A 动作的参数
 * 用在 B 动作上，静默丢弃比报错危险得多。
 * @module @dsh-plus/actual-mcp/invoke
 */

import type { ReportsActionPlan, ReportsPlan } from '@dsh-plus/actual-reports'
import { buildArgv } from './argv.ts'
import { type ActualCli, type CliDeps, parseJsonOrText } from './cli-run.ts'
import type { ActualCliBinding, CapabilityEntry, CliPlan } from './contract.ts'
import type { HelpTree } from './derive.ts'
import { collectInvokeHelp } from './discover.ts'
import type { CommanderHelp } from './help.ts'

/** 一次调用的执行选项。 */
export interface InvokeOptions {
  signal?: AbortSignal
  timeoutMs: number
}

/** 能力条目的执行器签名。 */
export type EntryInvoker = (
  entry: CapabilityEntry,
  args: Record<string, unknown>,
  options: InvokeOptions,
) => Promise<unknown>

/** 调用级 help 的缓存键。 */
function helpKey(family: string, action: string | undefined): string {
  return `${family} ${action ?? ''}`
}

/** 取（或补采）调用级 help。 */
async function invokeHelp(
  plan: CliPlan,
  action: string | undefined,
  cli: ActualCli,
  deps: CliDeps,
  cache: Map<string, CommanderHelp>,
): Promise<CommanderHelp> {
  const key = helpKey(plan.family, plan.kind === 'subcommands' ? action : undefined)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const help = await collectInvokeHelp(
    deps,
    cli.bound,
    plan.family,
    plan.kind === 'subcommands' ? action : undefined,
  )
  cache.set(key, help)
  return help
}

/** 组装调用目标的错误文案（`actual demo update`）。 */
function targetOf(plan: CliPlan, action: string | undefined): string {
  return action === undefined ? `actual ${plan.family}` : `actual ${plan.family} ${action}`
}

/**
 * 官方 CLI 入口：argv 前缀形如 `[node, /path/cli.js]` 时取脚本路径，
 * 形如 `['actual']` 时取命令名（伴侣 CLI 会自行在 PATH 上解析）。
 */
function cliEntryOf(binding: ActualCliBinding): string {
  return binding.argv.length > 1 ? (binding.argv[1] as string) : (binding.argv[0] as string)
}

/** 伴侣 CLI 的 argv 前缀（`[node, <pkg>/lib/bin/report.js]`）。 */
function reportsPrefix(deps: CliDeps): string[] {
  const entry = deps.resolveReportsCli?.()
  if (entry === undefined) {
    throw new Error(
      '报表能力不可用：找不到伴侣 CLI（@dsh-plus/actual-reports）。' +
        '请重新安装本插件包（pnpm install 或 dshctl install）后重试。',
    )
  }
  return [process.execPath, entry]
}

/**
 * 模型入参 → 伴侣 CLI argv。
 *
 * 与官方 CLI 的 buildArgv 同款纪律：**不适用该 action 的参数一律报错**，
 * 不静默丢弃——并集 schema 下模型很容易把 A 动作的参数用在 B 动作上。
 *
 * @returns `argv`、缺失的必填项与不适用的参数名。
 * @throws 取值类型不符（布尔/字符串）时抛出。
 */
export function buildReportsArgv(
  family: string,
  spec: ReportsActionPlan,
  args: Record<string, unknown>,
): { argv: string[]; missing: string[]; ignored: string[] } {
  const argv = [family, spec.action]
  const missing: string[] = []
  const declared = new Set(spec.args.map((arg) => arg.prop))
  const ignored = Object.keys(args).filter((key) => key !== 'action' && !declared.has(key))
  for (const arg of spec.args) {
    const value = args[arg.prop]
    if (value === undefined || value === null) {
      if (arg.required) missing.push(arg.prop)
      continue
    }
    if (arg.type === 'boolean') {
      if (typeof value !== 'boolean')
        throw new Error(`参数 ${arg.prop} 需要布尔值，实际为 ${JSON.stringify(value)}`)
      if (value) argv.push(`--${arg.flag}`)
      continue
    }
    if (arg.type === 'json') {
      argv.push(`--${arg.flag}`, JSON.stringify(value))
      continue
    }
    if (typeof value !== 'string') {
      throw new Error(`参数 ${arg.prop} 需要字符串，实际为 ${JSON.stringify(value)}`)
    }
    argv.push(`--${arg.flag}`, value)
  }
  return { argv, missing, ignored }
}

/** 伴侣 CLI 调用：同队列执行，并下发官方 CLI 入口供其现场解析 api。 */
async function invokeReports(
  entry: CapabilityEntry,
  plan: ReportsPlan,
  args: Record<string, unknown>,
  cli: ActualCli,
  deps: CliDeps,
  options: InvokeOptions,
): Promise<unknown> {
  const action = args.action
  if (typeof action !== 'string') {
    throw new Error(
      `缺少 action：${entry.name} 需要 action 参数（${plan.actions.map((item) => item.action).join(' / ')}）`,
    )
  }
  const spec = plan.actions.find((item) => item.action === action)
  if (spec === undefined) {
    throw new Error(
      `未知的 action：${entry.name} ${action}。可用：${plan.actions.map((item) => item.action).join(' / ')}`,
    )
  }
  const { argv, missing, ignored } = buildReportsArgv(plan.family, spec, args)
  if (missing.length > 0) {
    throw new Error(
      `缺少必填参数：${missing.join(', ')}（${plan.family} ${action}）。请对照该工具的参数描述补齐。`,
    )
  }
  if (ignored.length > 0) {
    throw new Error(
      `参数 ${ignored.join(', ')} 不适用于 ${plan.family} ${action}：该 action 没有这些选项，请改用对应 action 或去掉它们。`,
    )
  }
  const env: Record<string, string> = { [REPORTS_CLI_ENTRY_ENV]: cliEntryOf(cli.bound) }
  const stdout = await cli.runWith(reportsPrefix(deps), argv, options, env)
  return parseJsonOrText(stdout)
}

/** 传给伴侣 CLI 的官方 CLI 入口变量名（其据此现场解析 `@actual-app/api`）。 */
export const REPORTS_CLI_ENTRY_ENV = 'DSH_ACTUAL_CLI_ENTRY'

/**
 * 构造条目执行器：buildArgv → 串行 CLI → `--format json` 解析。
 * @param cli - 已绑定的 CLI 会话（串行队列的所有者）。
 * @param deps - 注入的 I/O 面（补采 help 用）。
 * @param tree - 发现阶段的 help 树（调用级 help 的首选缓存）。
 */
export function createEntryInvoker(cli: ActualCli, deps: CliDeps, tree: HelpTree): EntryInvoker {
  const cache = new Map<string, CommanderHelp>()
  for (const [key, help] of tree.actions) cache.set(key, help)
  for (const [family, help] of tree.families) cache.set(helpKey(family, undefined), help)

  return async (entry, args, options) => {
    if (entry.reports !== undefined) {
      return await invokeReports(entry, entry.reports, args, cli, deps, options)
    }
    const plan = entry.cli
    if (plan === undefined) throw new Error(`Actual 能力缺少 CLI 执行计划：${entry.name}`)
    const action =
      plan.kind === 'subcommands' && typeof args.action === 'string' ? args.action : undefined
    const help = await invokeHelp(plan, action, cli, deps, cache)
    const { argv, missingRequired, ignored } = buildArgv(args, plan, help)
    if (missingRequired.length > 0) {
      throw new Error(
        `缺少必填参数：${missingRequired.join(', ')}（${targetOf(plan, action)}）。` +
          '若不确定用法，请先用该工具的动作说明与参数描述核对。',
      )
    }
    if (ignored.length > 0) {
      throw new Error(
        `参数 ${ignored.join(', ')} 不适用于 ${targetOf(plan, action)}：` +
          '该 action 没有这些选项，请改用对应 action 或去掉它们。',
      )
    }
    const stdout = await cli.run([plan.family, ...argv], options)
    return parseJsonOrText(stdout)
  }
}
