/**
 * 能力条目 → CLI 调用（MCP 服务端与 DSH 兜底共用同一条执行链）。
 *
 * 调用级 help 优先取发现阶段的缓存，未采到时按需补采；参数完整性与「属性是否
 * 适用于该 action」都在此层显式报错——并集 schema 下模型很容易把 A 动作的参数
 * 用在 B 动作上，静默丢弃比报错危险得多。
 * @module @dsh-plus/actual-mcp/invoke
 */

import { buildArgv } from './argv.ts'
import { type ActualCli, type CliDeps, parseJsonOrText } from './cli-run.ts'
import type { CapabilityEntry, CliPlan } from './contract.ts'
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
