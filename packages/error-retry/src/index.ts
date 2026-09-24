/**
 * dsh 插件：把按模糊模式匹配的特定 LLM 报错纳入上游重试（error-retry）。
 *
 * 问题：上游 `@deepseek-ai/dsh-llm-retry` 的 normal 模式只重试
 * `retryableCodes` 内的 code（默认 EMPTY_RESPONSE/RATE_LIMIT/SERVER/
 * TIMEOUT/TRANSPORT）；诸如 pi-ai 归类的 `PI_AI_ERROR`
 * （消息形如 `Provider finish_reason: content_filter`）落在名单外，
 * 一次命中即终止轮次。
 *
 * 机制：以 `prepend: true` 抢在 llm-retry 之前挂上 agent/request-error
 * waterfall——命中配置模式时，就地把 failure.code 并入载荷里 retryPolicy
 * 的副本（原对象 frozen，只换载荷引用），随即 `next()`。此后退避计算、
 * `llm/retry`/`llm/retry-started` 持久事件、会话内次数预算、取消语义
 * 全部仍由上游执行，本插件零重试机制、不发任何模型请求。
 *
 * 明确不做：
 * - 不改写 failure 本身（原始失败事实与 llm/retry 事件记录不受影响）；
 * - 不自实现等待/退避/事件追加（那是 dsh-llm-retry 的职责）；
 * - 不介入 always 模式、适配器选择前的失败、已可重试的 code（上游已覆盖）。
 * @module @dsh-plus/error-retry
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'

import { Config, type ErrorRetryConfig } from './config.ts'
import { compilePatterns, findMatchedPattern } from './match.ts'
import { selectPolicy } from './policy.ts'

export const name = 'dsh-plus-error-retry'

export type { ErrorRetryConfig }
export { Config }

/** 无硬 inject：仅注册事件监听，不消费任何 cordis 服务。 */
export const inject = [] as const

/**
 * 本插件读取/改写的 agent/request-error 载荷子集（结构超集即兼容，
 * 上游完整载荷的 agent/turn/step/signal 均可赋入）。
 */
export interface RequestErrorPayload {
  /** 失败的可序列化事实（只读，不改写）。 */
  readonly failure: LlmFailure
  /** 本次请求的 provider 路由名（日志上下文用）。 */
  readonly provider: string
  /** 已解析的 provider 重试策略；可改写引用（原对象 frozen 不可变）。 */
  retryPolicy: ResolvedRetryPolicy | undefined
}

/** waterfall 下游续接函数（由 cordis 提供）。 */
export type Next = () => Promise<RequestErrorAction>

/**
 * 构造 agent/request-error 监听器：命中即改写载荷策略，始终续接 next。
 * 模式编译在此一次性完成——正则配置错误在插件装载期即暴露。
 * @param config - 已由 schemastery 解析的插件配置。
 * @param log - 单行日志出口（命中改写时记录上下文）。
 * @returns 可注册到 agent/request-error 的 waterfall 监听器。
 */
function createRequestErrorListener(
  config: ErrorRetryConfig,
  log: (message: string) => void,
): (payload: RequestErrorPayload, next: Next) => Promise<RequestErrorAction> {
  const compiled = compilePatterns(config.patterns)
  return (payload, next) => {
    const matched = findMatchedPattern(compiled, payload.failure.message)
    if (matched === undefined) return next()
    const rewritten = selectPolicy(payload.retryPolicy, payload.failure, true, config.maxRetries)
    if (rewritten === undefined) return next()
    payload.retryPolicy = rewritten
    log(
      `failure ${payload.failure.code} on provider "${payload.provider}" matched pattern` +
        ` "${matched.pattern}"; retryPolicy rewritten (maxRetries=${config.maxRetries})` +
        ' for upstream llm-retry',
    )
    return next()
  }
}

/**
 * 注册监听：enabled=false 时零副作用（等价插件缺席）。
 * @param ctx - 宿主上下文。
 * @param config - 已由 schemastery 解析的插件配置。
 */
export function apply(ctx: Context, config: ErrorRetryConfig): void {
  if (config.enabled !== true) return
  const logger = ctx.logger('error-retry')
  const listener = createRequestErrorListener(config, (message) => logger.info(message))
  // prepend 抢在 dsh-llm-retry（dsh-base 层注册）之前改写载荷，否则上游
  // 先按原策略裁定不重试，本插件的改写将永远来不及生效。
  ctx.on('agent/request-error', listener, { prepend: true })
  logger.info(`installed (patterns=${config.patterns.length}, maxRetries=${config.maxRetries})`)
}
