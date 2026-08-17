/**
 * 手动技能 provider 包装器：把任意 SkillProvider 的发现/加载结果强制映射为
 * 「仅用户可触发」策略（modelInvocable: false）。
 *
 * 设计决策：位置即语义——manual 根目录下的 skill 一律不对模型开放，
 * frontmatter 无法重新打开模型调用；`user-invocable: false` 仍受尊重（完全隐藏）。
 * @module @dsh-plus/skill-manual/manual-provider
 */
import type {
  SkillCandidate,
  SkillDefinition,
  SkillProvider,
  SkillProviderObservation,
  SkillSummary,
} from '@deepseek-ai/dsh-skill'

/** 强制仅用户触发的 invocation 策略映射，保留其余全部字段（含 locator/resourceBase）。 */
export function toManualSkill<T extends SkillSummary>(skill: T): T {
  return {
    ...skill,
    invocation: {
      modelInvocable: false,
      userInvocable: skill.invocation.userInvocable,
    },
  }
}

function isObservation(
  result: readonly SkillCandidate[] | SkillProviderObservation,
): result is SkillProviderObservation {
  return !Array.isArray(result)
}

/**
 * 包装一个 inner provider：name 透传；list/get 的结果强制手动策略；
 * observation 形态与 complete 标志原样保留。
 */
export function createManualProvider(inner: SkillProvider): SkillProvider {
  return {
    name: inner.name,
    async list(options) {
      const result = await inner.list(options)
      if (isObservation(result)) {
        return { candidates: result.candidates.map(toManualSkill), complete: result.complete }
      }
      return result.map(toManualSkill)
    },
    async get(candidate, options): Promise<SkillDefinition | undefined> {
      const definition = await inner.get(candidate, options)
      return definition === undefined ? undefined : toManualSkill(definition)
    },
  }
}
