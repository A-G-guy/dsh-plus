/**
 * /reload 命令：经官方 commands 注册表分发，handler 在 host 侧执行，
 * 结果文本直渲会话 UI、不进模型上下文（零 token）。
 * 语法：`/reload`（进程内重载，零中断）·`/reload force`（跳过运行中会话防线）·
 * `/reload restart [force]`（systemd 重启，供换包/平台升级等只能重启的变更）·
 * `/reload cancel`（取消待执行重启）·`/reload status`（能力+预检+待重启报告）。
 * 纯核心 runReloadCommand 与 cordis 注册分离，测试直接驱动纯核心。
 * @module reload/command
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

import type { PreflightResult } from './preflight.ts'
import type { ApplyReport } from './report.ts'
import type { ReloadScheduler } from './scheduler.ts'

const USAGE =
  '用法: /reload · /reload force · /reload restart [force] · /reload cancel · /reload status'

export interface CommandDeps {
  /** 进程内重载（含运行中会话防线与待重启报告）。 */
  apply: (options: { force: boolean }) => Promise<ApplyReport>
  /** `/reload status` 文本（能力位 + 重启通道预检 + 调度状态 + 待重启清单）。 */
  status: () => Promise<string>
  scheduler: ReloadScheduler
  preflight: () => Promise<PreflightResult>
  runningAgents: () => number
}

function formatPreflightFailure(preflight: PreflightResult): CommandResult {
  const lines = preflight.reasons.map((reason) => `- ${reason}`).join('\n')
  return { kind: 'error', text: `重启预检未通过，已拒绝调度：\n${lines}` }
}

/** 重启路径共享段：prepare + confirm，按结果生成文案。 */
function scheduleRestart(deps: CommandDeps, force: boolean): CommandResult {
  const { scheduler } = deps
  const running = deps.runningAgents()
  const { token } = scheduler.prepare()
  const result = scheduler.confirm(token, { force, runningAgents: running })
  if (result.kind === 'agents-running') {
    return {
      kind: 'error',
      text: `检测到 ${result.count} 个会话正在运行，重启将打断它们。确认请执行 /reload restart force。`,
    }
  }
  if (result.kind !== 'scheduled') {
    return { kind: 'error', text: '调度失败：内部状态冲突，请重试。' }
  }
  return {
    kind: 'success',
    text: `已调度：约 ${(result.etaMs / 1000).toFixed(1)} 秒后重启 dsh-web，服务恢复后请刷新页面（设置页按钮路径会自动刷新）。取消请执行 /reload cancel。`,
  }
}

/** 命令纯核心：解析 rawInput 并执行，返回直渲结果。 */
export async function runReloadCommand(
  rawInput: string,
  deps: CommandDeps,
): Promise<CommandResult> {
  const [verb, ...rest] = rawInput.trim().toLowerCase().split(/\s+/)

  if (verb === 'cancel') {
    return deps.scheduler.abort()
      ? { kind: 'success', text: '已取消待执行的重启。' }
      : { kind: 'success', text: '当前没有待确认或待执行的重启。' }
  }

  if (verb === 'status') {
    return { kind: 'success', text: await deps.status() }
  }

  if (verb === 'restart') {
    const preflight = await deps.preflight()
    if (!preflight.ok) return formatPreflightFailure(preflight)
    return scheduleRestart(deps, rest[0] === 'force')
  }

  if (verb === undefined || verb === '' || verb === 'force') {
    const report = await deps.apply({ force: verb === 'force' })
    return report.status === 'applied'
      ? { kind: 'success', text: report.text }
      : { kind: 'error', text: report.text }
  }

  return { kind: 'error', text: `未识别的参数。${USAGE}` }
}

/** 注册 /reload 命令（commands 服务缺失时由调用方保证不调用）。 */
export function registerReloadCommand(ctx: Context, deps: CommandDeps): void {
  ctx.commands.register({
    name: 'reload',
    description:
      '进程内重载 profile 组合层（零中断）；restart 重启服务 / force 强制执行 / cancel 取消 / status 报告',
    input: { hint: '[force|restart [force]|cancel|status]' },
    handler: async (invocation) => runReloadCommand(invocation.rawInput, deps),
  })
}
