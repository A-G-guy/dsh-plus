/**
 * 运行时挂钩：子代理模型路由的注入点。
 *
 * 机制依据（官方 dsh-subagent 0.2.1-alpha.2）：子代理的模型由【创建时】的
 * AgentOptions 决定——`resolveChildAgentOptions(parent, request.agentOptions,
 * childDepth)` = 父 options 快照 + 显式 agentOptions（后者胜出），且原生读取
 * provider/model/reasoningEffort 三个字段（materialize → agents.create/resume
 * → agentLoop.options），冷恢复经 descriptor 持久化保持。因此只需在
 * `spec.request.agentOptions` 注入 provider/model/reasoningEffort 即可命中路由，
 * 无需搬运任何私有字段。
 *
 * 挂钩面：官方把"一次性执行"与"可继续子代理"统一收进
 * `SubagentRuntime.startActivation(spec)`（旧版 `start` / `startContinuable` 已
 * 移除），spec 以 `provider` 选后端、`request` 携带委托请求，故单点包装即可覆盖
 * 全部委托路径。挂钩幂等（Symbol 标记 + dispose 恢复），HMR 重载安全。
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

/** 子代理服务的最小运行期面（仅包装用到的唯一创建入口）。 */
export interface SubagentsLike {
  startActivation(spec: SubagentActivationSpec): Promise<unknown>
}

/** 子代理创建请求的窄面（只读 agentOptions）。 */
export interface SubagentStartRequest {
  agentOptions?: InjectedOptions
}

/** 委托激活规范的窄面：后端名 + 创建请求。 */
export interface SubagentActivationSpec {
  provider: string
  request: SubagentStartRequest
}

/**
 * 包装 `ctx.subagents.startActivation`：按 provider 名命中配置条目（未命中回落
 * default 条目），向委托请求注入 agentOptions——调用方显式携带的 agentOptions
 * （工具行配置 / 主代理显式选择）优先，插件只补空缺。未命中条目时完全直通
 * （原生继承主代理行为）。
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
  const originalStart = subagents.startActivation.bind(subagents)
  subagents.startActivation = async (spec) => {
    const injected = entryFor(current, spec.provider)
    if (injected === undefined) return originalStart(spec)
    return originalStart({
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
      subagents.startActivation = originalStart
      delete marked[WRAPPED]
    },
    'subagent-model: delegation hook',
  )
}
