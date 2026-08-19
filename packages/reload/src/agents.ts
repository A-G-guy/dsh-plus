/**
 * 活动会话检测：枚举 live agent 中 status 为 running 的数量。
 * agents 服务缺席（非交互组合）时由调用方降级为 0——本模块只做纯计数。
 * @module reload/agents
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

export interface AgentLike {
  readonly status: 'idle' | 'running'
}

export interface AgentsLike {
  list(): AgentLike[]
}

/** 从 ctx 读取 agents 服务（缺席返回 undefined，由调用方决定降级策略）。 */
export function agentsOf(ctx: Context): AgentsLike | undefined {
  return (ctx as { agents?: AgentsLike }).agents
}

export function countRunning(agents: AgentsLike | undefined): number {
  if (!agents) return 0
  return agents.list().filter((agent) => agent.status === 'running').length
}
