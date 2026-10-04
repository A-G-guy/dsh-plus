/**
 * 运行时环境快照：以 system-prompt 动态 context（用户侧快照）向模型提供
 * Actual 连接事实、CLI/服务端版本与当前日期。
 *
 * 版本不匹配、CLI 降级、最近错误都在这里对模型可见——**不静默带过**；
 * `includeRuntimeContext: false` 时官方注册表会整体丢弃该快照。
 * @module @dsh-plus/actual-tools/env
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ActualService, ActualStatus } from '@dsh-plus/actual'

/** 上下文排序位：位于官方 SANDBOX_POLICY(110)/APPROVAL_POLICY(115)/SUBAGENT(120) 之后。 */
const ENV_CONTEXT_ORDER = 130
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** system-prompt 服务窄面（仅用注册动态 context 的能力）。 */
interface SystemPromptLike {
  context(contribution: { name: string; order: number; text: () => string }): () => void
}

/** 本地日期（`2026-10-05 Mon`）。 */
export function formatDate(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day} ${WEEKDAYS[now.getDay()] ?? ''}`
}

/** 版本一致性的人类可读描述。 */
function versionNote(status: ActualStatus): string {
  if (status.versionStatus === 'ok') return 'versions aligned'
  if (status.versionStatus === 'mismatch') {
    return `VERSION MISMATCH between CLI ${status.cliVersion || 'unknown'} and server ${status.serverVersion || 'unknown'} — report it if a call fails`
  }
  return 'version unknown'
}

/**
 * 快照文本：CLI 来源与版本、服务端地址与版本、MCP 会话状态、日期与最近错误（已脱敏）。
 * @param status - 服务状态（不含密钥）。
 * @param now - 当前时间（测试可注入）。
 */
export function buildEnvText(status: ActualStatus, now: Date = new Date()): string {
  const lines = [
    `Actual Budget: CLI ${status.cliVersion !== '' ? status.cliVersion : 'unknown'} (${status.cli}) → ` +
      `server ${status.serverVersion !== '' ? status.serverVersion : 'unknown'} at ${status.serverUrl} — ` +
      `MCP ${status.mcpConnected ? 'connected' : 'degraded to CLI'}, ${versionNote(status)}.`,
    `Date: ${formatDate(now)}`,
  ]
  if (status.lastError !== undefined) lines.push(`Last error: ${status.lastError}`)
  return lines.join('\n')
}

/**
 * 注册作用域环境快照；system-prompt 服务缺席时安全空转。
 * @param ctx - 预设作用域上下文。
 * @param actual - 主插件服务（每次装配现取状态）。
 */
export function registerEnvContext(ctx: Context, actual: ActualService): () => void {
  const prompt = ctx.get('systemPrompt') as SystemPromptLike | undefined
  if (prompt === undefined || typeof prompt.context !== 'function') return () => {}
  return prompt.context({
    name: 'actual:env',
    order: ENV_CONTEXT_ORDER,
    text: () => buildEnvText(actual.status()),
  })
}
