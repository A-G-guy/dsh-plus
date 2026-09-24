/**
 * 重试策略改写：把命中的 failure.code 并入一份 normal 策略副本。
 *
 * 纯函数且确定性——同一 (policy, failure.code, matched, maxRetries) 输入
 * 恒产出同一 retryPolicyKey 组成（见 dsh-llm-retry 的 key：mode、maxRetries、
 * 排序后的 retryableCodes、backoff 三元组），llm-retry 的会话内次数预算
 * 因此跨 attempt 正确累积，直至耗尽后由上游终态收口。
 *
 * 旁路条件（一律返回 undefined，上游行为不变）：
 * - 未命中任何匹配模式；
 * - 无策略（适配器选择前的失败，无 provider 策略可挂靠）；
 * - always 模式（上游本就无条件重试）；
 * - code 已在 retryableCodes（上游预算已覆盖，不越权改次数）。
 * @module @dsh-plus/error-retry/policy
 */
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'

/**
 * 计算改写后的重试策略。
 * @param policy - 上游载荷携带的已解析 provider 策略（可缺席）。
 * @param failure - 本次失败的可序列化事实。
 * @param matched - failure.message 是否命中配置模式。
 * @param maxRetries - 插件配置的重试次数上限。
 * @returns 改写后的策略副本；旁路场景返回 undefined。
 */
export function selectPolicy(
  policy: ResolvedRetryPolicy | undefined,
  failure: LlmFailure,
  matched: boolean,
  maxRetries: number,
): ResolvedRetryPolicy | undefined {
  if (!matched) return undefined
  if (policy === undefined) return undefined
  if (policy.mode === 'always') return undefined
  if (policy.retryableCodes.includes(failure.code)) return undefined
  // 原策略 frozen，spread 出可写副本；Set 展开保证 code 不重复且顺序确定。
  return {
    ...policy,
    maxRetries,
    retryableCodes: [...new Set([...policy.retryableCodes, failure.code])],
  }
}
