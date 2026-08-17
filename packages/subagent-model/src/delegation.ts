/**
 * 运行时挂钩：子代理模型路由的注入点。
 *
 * 机制依据（官方 dsh-subagent / dsh-agent-loop）：
 * - 子代理的模型由【创建时】的 AgentOptions 决定：`resolveChildAgentOptions(parent,
 *   request.agentOptions, depth)` = 父 options 快照 + 显式 agentOptions（后者胜出）。
 *   子代理不经 api-proxy 的 create/resume setup，不安装模型 selection，
 *   `agent/request` 瀑布默认无人覆盖 —— 因此 provider/model 只需注入
 *   `request.agentOptions`，路由即命中。
 * - reasoningEffort 不在 AgentOptions 读取路径上（AgentLoop 只读 provider/model/maxTokens，
 *   子代理 buildRequest 的 effort 仅来自自身 session 折叠的 request/header）。
 *   故 effort 以私有字段随 agentOptions 抵达子代理 options，再由根 ctx 的
 *   `agent/request` 瀑布监听器应用（origin==='subagent' 过滤）。
 * - 冷恢复（continuable resume）：descriptor 持久化 agentProvider/agentModel
 *   （来自 request.agentOptions），恢复后模型保持；effort 经 session log 的
 *   request/header 保留 —— 与热路径注入结果一致。
 *
 * 两个挂钩均幂等（Symbol 标记 + dispose 恢复），HMR 重载安全。
 * @module subagent-model/delegation
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { ContinuableStartSpec, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'

import { applyEffort, mergeAgentOptions, resolveEntry, type RequestConfig, type SubagentModelConfig } from './config.ts'

const WRAPPED = Symbol('dsh-custom-subagent-model.wrapped')

/** 子代理服务的最小运行期面（仅包装用到的两个入口）。 */
interface SubagentsLike {
  start(name: string, request: SubagentStartRequest): Promise<unknown>
  startContinuable(spec: ContinuableStartSpec): Promise<unknown>
}

function entryFor(current: () => SubagentModelConfig, name: string | undefined) {
  if (name === undefined) return undefined
  const entry = current().entries[name]
  return entry === undefined ? undefined : resolveEntry(entry)
}

/**
 * 包装 `ctx.subagents.start` / `startContinuable`：按 provider 名命中配置条目，
 * 向委托请求注入 agentOptions（显式工具行配置优先，插件只补空缺）。
 * 未命中条目时完全直通（原生继承主代理行为）。
 * 返回注销函数（恢复原方法），随调用方 fiber 释放。
 */
export function installDelegationHook(
  ctx: Context,
  current: () => SubagentModelConfig,
): () => void {
  const subagents = ctx.get('subagents') as SubagentsLike | undefined
  if (subagents === undefined) {
    ctx.logger('subagent-model').warn('subagents 服务不可用，跳过委托挂钩')
    return () => {}
  }
  const marked = subagents as SubagentsLike & { [WRAPPED]?: boolean }
  if (marked[WRAPPED]) {
    ctx.logger('subagent-model').warn('subagents 服务已被本插件包装，跳过重复挂钩')
    return () => {}
  }
  const originalStart = subagents.start.bind(subagents)
  const originalContinuable = subagents.startContinuable.bind(subagents)
  subagents.start = async (name, request) => {
    const injected = entryFor(current, name)
    if (injected === undefined) return originalStart(name, request)
    return originalStart(name, {
      ...request,
      agentOptions: mergeAgentOptions(injected, request.agentOptions),
    })
  }
  subagents.startContinuable = async (spec) => {
    const injected = entryFor(current, spec.provider)
    if (injected === undefined) return originalContinuable(spec)
    return originalContinuable({
      ...spec,
      request: {
        ...spec.request,
        agentOptions: mergeAgentOptions(injected, spec.request.agentOptions),
      },
    })
  }
  marked[WRAPPED] = true
  return ctx.effect(
    () => () => {
      subagents.start = originalStart
      subagents.startContinuable = originalContinuable
      delete marked[WRAPPED]
    },
    'subagent-model: delegation hook',
  )
}

/**
 * 读取一次 LLM 请求的发起 agent 上本插件携带的 effort 私有标记：
 * 仅对子代理（session header origin==='subagent'）生效，主代理不受影响。
 * 纯函数（agent 为最小结构面），便于单测。
 */
export function childEffortOf(agent: {
  session: { header: { origin?: 'subagent' } }
  options: AgentOptions & { reasoningEffort?: string }
}): string | undefined {
  if (agent.session.header.origin !== 'subagent') return undefined
  return agent.options.reasoningEffort
}

/**
 * 根 ctx 监听 `agent/request` 瀑布：对子代理应用条目配置的思考程度。
 * provider/model 无需在此处理（路由直接读 options）。
 * 根级监听覆盖 HMR 重载后已存在子代理的后续请求。
 */
export function installChildRoute(ctx: Context): void {
  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const effort = childEffortOf(payload.agent)
    if (effort === undefined) return resolved
    return applyEffort(resolved as RequestConfig, effort) as LlmCallConfig
  })
}
