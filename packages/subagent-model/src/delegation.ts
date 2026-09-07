/**
 * 运行时挂钩：子代理模型路由的注入点。
 *
 * 机制依据（官方 dsh-subagent 0.1.2-rc.1）：子代理的模型由【创建时】的
 * AgentOptions 决定——`resolveChildAgentOptions(parent, request.agentOptions,
 * childDepth)` = 父 options 快照 + 显式 agentOptions（后者胜出），且原生读取
 * provider/model/reasoningEffort 三个字段（materialize → agents.create/resume
 * → agentLoop.options），冷恢复（continuable resume）经 descriptor 持久化保持。
 * 因此只需在 `request.agentOptions` 注入 provider/model/reasoningEffort，
 * 路由即命中，无需旧版 effort 瀑布的私有字段搬运。
 *
 * 两个挂钩均幂等（Symbol 标记 + dispose 恢复），HMR 重载安全。
 * @module @dsh-plus/subagent-model/delegation
 */
import type { Context } from '@deepseek-ai/cordis'

import {
  entryFor,
  type InjectedOptions,
  mergeAgentOptions,
  type SubagentModelConfig,
} from './config.ts'

const WRAPPED = Symbol('dsh-plus-subagent-model.wrapped')

/** 子代理服务的最小运行期面（仅包装用到的两个入口）。 */
export interface SubagentsLike {
  start(name: string, request: SubagentStartRequest): Promise<unknown>
  startContinuable(spec: ContinuableStartSpec): Promise<unknown>
}

/** 子代理创建请求的窄面（只读 agentOptions）。 */
export interface SubagentStartRequest {
  agentOptions?: InjectedOptions
}

/** 可继续子代理启动规范的窄面。 */
export interface ContinuableStartSpec {
  provider: string
  request: SubagentStartRequest
}

/**
 * 包装 `ctx.subagents.start` / `startContinuable`：按 provider 名命中配置条目
 * （未命中回落 default 条目），向委托请求注入 agentOptions——调用方显式携带
 * 的 agentOptions（工具行配置 / 主代理显式选择）优先，插件只补空缺。
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
