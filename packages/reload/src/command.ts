/**
 * /reload 命令：经官方 commands 注册表分发，handler 在 host 侧执行，
 * 结果文本直渲会话 UI、不进模型上下文（零 token）。
 * 语法：`/reload`（预检→调度）·`/reload force`（跳过 running 防线）·
 * `/reload cancel`（无 token 取消本地面流程）·`/reload status`（预检+状态报告）。
 * 纯核心 runReloadCommand 与 cordis 注册分离，测试直接驱动纯核心。
 * @module reload/command
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

import type { PreflightResult } from './preflight.ts'
import type { ReloadScheduler } from './scheduler.ts'

const USAGE = '用法: /reload · /reload force · /reload cancel · /reload status'

export interface CommandDeps {
  scheduler: ReloadScheduler
  preflight: () => Promise<PreflightResult>
  runningAgents: () => number
}

function formatPreflightFailure(preflight: PreflightResult): CommandResult {
  const lines = preflight.reasons.map((reason) => `- ${reason}`).join('\n')
  return { kind: 'error', text: `重启预检未通过，已拒绝调度：\n${lines}` }
}

/** 调度共享段：prepare + confirm，按结果生成文案。 */
function schedule(deps: CommandDeps, force: boolean): CommandResult {
  const { scheduler } = deps
  const running = deps.runningAgents()
  const { token } = scheduler.prepare()
  const result = scheduler.confirm(token, { force, runningAgents: running })
  if (result.kind === 'agents-running') {
    return {
      kind: 'error',
      text: `检测到 ${result.count} 个会话正在运行，重启将打断它们。确认请执行 /reload force。`,
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
  const arg = rawInput.trim().toLowerCase()

  if (arg === 'cancel') {
    return deps.scheduler.abort()
      ? { kind: 'success', text: '已取消待执行的重启。' }
      : { kind: 'success', text: '当前没有待确认或待执行的重启。' }
  }

  if (arg === 'status') {
    const preflight = await deps.preflight()
    const state = deps.scheduler.getState()
    const running = deps.runningAgents()
    const lines = [
      `预检: ${preflight.ok ? '通过' : '未通过'}`,
      ...preflight.reasons.map((reason) => `- ${reason}`),
      `调度状态: ${state}；运行中会话: ${running}；bootId: ${deps.scheduler.bootId}`,
    ]
    return { kind: preflight.ok ? 'success' : 'error', text: lines.join('\n') }
  }

  if (arg === '' || arg === 'force') {
    const preflight = await deps.preflight()
    if (!preflight.ok) return formatPreflightFailure(preflight)
    return schedule(deps, arg === 'force')
  }

  return { kind: 'error', text: `未识别的参数。${USAGE}` }
}

/** 注册 /reload 命令（commands 服务缺失时由调用方保证不调用）。 */
export function registerReloadCommand(ctx: Context, deps: CommandDeps): void {
  ctx.commands.register({
    name: 'reload',
    description: '重启 dsh-web 服务（插件变更生效）；force 强制 / cancel 取消 / status 预检',
    input: { hint: '[force|cancel|status]' },
    handler: async (invocation) => runReloadCommand(invocation.rawInput, deps),
  })
}
