/**
 * 运行时环境快照：以 system-prompt 动态 context（用户侧快照）向模型提供
 * SiYuan 连接事实与当前日期——对应思源内置提示词的 `<env>` 块。
 * `includeRuntimeContext: false` 时官方注册表会整体丢弃该快照。
 * @module @dsh-plus/siyuan-tools/env
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SiyuanService, SiyuanStatus } from '@dsh-plus/siyuan'

/** 上下文排序位：位于官方 SANDBOX_POLICY(110)/APPROVAL_POLICY(115)/SUBAGENT(120) 之后。 */
const ENV_CONTEXT_ORDER = 130
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** system-prompt 服务窄面（仅用注册动态 context 的能力）。 */
interface SystemPromptLike {
  context(contribution: { name: string; order: number; text: () => string }): () => void
}

/** 本地日期（`2026-09-30 Wed`）。 */
export function formatDate(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day} ${WEEKDAYS[now.getDay()] ?? ''}`
}

/**
 * 快照文本：版本、形态、端点、MCP/CLI 可用性、日期与最近错误（已脱敏）。
 * @param status - 服务状态（不含 token）。
 * @param now - 当前时间（测试可注入）。
 */
export function buildEnvText(status: SiyuanStatus, now: Date = new Date()): string {
  const lines = [
    `SiYuan: ${status.version !== '' ? status.version : 'unknown'} via ${status.mode} (${status.endpoint}) — ` +
      `MCP ${status.mcpConnected ? 'connected' : 'disconnected'}, CLI ${status.cliAvailable ? 'available' : 'unavailable'}.`,
    `Date: ${formatDate(now)}`,
  ]
  if (status.lastError !== undefined) lines.push(`Last error: ${status.lastError}`)
  return lines.join('\n')
}

/**
 * 注册作用域环境快照；system-prompt 服务缺席时安全空转。
 * @param ctx - 预设作用域上下文。
 * @param siyuan - 主插件服务（每次装配现取状态）。
 */
export function registerEnvContext(ctx: Context, siyuan: SiyuanService): () => void {
  const prompt = ctx.get('systemPrompt') as SystemPromptLike | undefined
  if (prompt === undefined || typeof prompt.context !== 'function') return () => {}
  return prompt.context({
    name: 'siyuan:env',
    order: ENV_CONTEXT_ORDER,
    text: () => buildEnvText(siyuan.status()),
  })
}
