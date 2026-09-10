/**
 * 公共契约检查：以「产物视角」核对各包 lib/*.d.ts 的导出类型。
 *
 * 为什么单独一层：逐包 `tsc --noEmit` 的 include 只含 src/tests，读不到 lib/；
 * `skipLibCheck: true` 又让 .d.ts 内部问题沉默。于是产物里的类型退化（最典型是
 * 配置 schema 推断链被显式 `any` 切断 → 导出类型整体变成 any）在现有闸门下全绿。
 * 本文件把关键契约写成编译期断言，由 dshctl typecheck 第二阶段执行。
 *
 * 断言写法：`Expect<Equal<X, 期望>>`，X 必须是**具体类型**（不可包成带裸类型参数
 * 的泛型助手，否则会因分布式求值静默失效，详见 shared/types/assert.ts 的说明）。
 * 若 X 退化为 any，则 `X['某字段']` 仍是 any、`keyof X` 是 string|number|symbol，
 * 与期望不等即报错——故字段与 keyof 断言天然是 any 退化的探测器。
 *
 * 本文件零运行期产物（仅类型引用）。
 */

import type { Config as AccessGateSchema } from '@dsh-plus/access-gate'
import type { Config as ImageStudioSchema } from '@dsh-plus/image-studio'
import type { Config as LifeboatSchema } from '@dsh-plus/lifeboat'
import type { Config as LlmPiSchema } from '@dsh-plus/llm-pi'
import type { Config as NotifyEmailSchema } from '@dsh-plus/notify-email'
import type { Config as ReloadSchema } from '@dsh-plus/reload'
import type { Config as SecretEnvSchema } from '@dsh-plus/secret-env'
import type { Equal, Expect } from '@dsh-plus/shared'
import type { Config as SubagentModelSchema } from '@dsh-plus/subagent-model'
import type { Config as UsagePanelSchema } from '@dsh-plus/usage-panel'
import type { Config as WebTerminalSchema } from '@dsh-plus/web-terminal'

// ── 断言工具自检：若 Equal 退化为恒真，下面全部断言会静默失效 ─────────────────
// 关键：自检不能经由 Equal 自身判定（Equal 坏掉时 Equal<X,false> 也是 true，
// 那样自检同样恒真）。故把 Equal 的结果钉到字面量上，再用独立的 extends 判据检查。
type _EqDifferent = Equal<string, number>
type _SelfTestDifferent = Expect<[_EqDifferent] extends [false] ? true : false>

/* biome-ignore lint/suspicious/noExplicitAny: 自检必须真的传入 any 才能验证判别力 */
type _EqAny = Equal<any, { a: 1 }>
type _SelfTestAny = Expect<[_EqAny] extends [false] ? true : false>

type _EqWiden = Equal<string, string | undefined>
type _SelfTestWiden = Expect<[_EqWiden] extends [false] ? true : false>

type _EqSame = Equal<{ a: 1 }, { a: 1 }>
type _SelfTestSame = Expect<[_EqSame] extends [true] ? true : false>

// ── access-gate ───────────────────────────────────────────────────────────
type AccessGateConfig = Schemastery.TypeT<typeof AccessGateSchema>
type _AgEnabled = Expect<Equal<AccessGateConfig['enabled'], boolean>>
type _AgAllowedIps = Expect<Equal<AccessGateConfig['allowedIps'], string[]>>
type _AgTrustFwd = Expect<Equal<AccessGateConfig['trustForwardedFor'], boolean>>

// ── lifeboat ──────────────────────────────────────────────────────────────
type LifeboatConfig = Schemastery.TypeT<typeof LifeboatSchema>
type _LbEnabled = Expect<Equal<LifeboatConfig['enabled'], boolean>>
type _LbCooldown = Expect<Equal<LifeboatConfig['alertCooldownMs'], number>>
type _LbPatchFile = Expect<Equal<LifeboatConfig['patchFile'], string>>

// ── llm-pi ────────────────────────────────────────────────────────────────
type LlmPiConfig = Schemastery.TypeT<typeof LlmPiSchema>
type _LpEnabled = Expect<Equal<LlmPiConfig['enabled'], boolean>>
type _LpCatalogUrl = Expect<Equal<LlmPiConfig['catalogUrl'], string>>
type _LpRefreshHours = Expect<Equal<LlmPiConfig['catalogRefreshHours'], number>>

// ── notify-email ──────────────────────────────────────────────────────────
type NotifyEmailConfig = Schemastery.TypeT<typeof NotifyEmailSchema>
type _NeEnabled = Expect<Equal<NotifyEmailConfig['enabled'], boolean>>
type _NeTo = Expect<Equal<NotifyEmailConfig['to'], string[]>>
type _NeDryRun = Expect<Equal<NotifyEmailConfig['dryRun'], boolean>>

// ── reload ────────────────────────────────────────────────────────────────
type ReloadConfig = Schemastery.TypeT<typeof ReloadSchema>
type _RlEnabled = Expect<Equal<ReloadConfig['enabled'], boolean>>
type _RlUnitName = Expect<Equal<ReloadConfig['unitName'], string>>
type _RlGrace = Expect<Equal<ReloadConfig['serverGraceMs'], number>>

// ── subagent-model ────────────────────────────────────────────────────────
type SubagentModelConfig = Schemastery.TypeT<typeof SubagentModelSchema>
type _SmEnabled = Expect<Equal<SubagentModelConfig['enabled'], boolean>>

// ── usage-panel（顶层形状；prices 元素级断言待阶段四后补）──────────────────
type UsagePanelConfig = Schemastery.TypeT<typeof UsagePanelSchema>
type _UpCurrency = Expect<Equal<UsagePanelConfig['currency'], string>>
type _UpAutoSync = Expect<Equal<UsagePanelConfig['autoSyncMinutes'], number>>
type _UpPriceProvider = Expect<Equal<UsagePanelConfig['prices'][number]['provider'], string>>
type _UpPriceInput = Expect<Equal<UsagePanelConfig['prices'][number]['inputPerMtok'], number>>

// ── secret-env（顶层形状）─────────────────────────────────────────────────
type SecretEnvConfig = Schemastery.TypeT<typeof SecretEnvSchema>
type _SeMasked = Expect<Equal<SecretEnvConfig['masked'], string[]>>
type _SeSecretName = Expect<Equal<SecretEnvConfig['secrets'][number]['name'], string>>

// ── image-studio（顶层形状）───────────────────────────────────────────────
type ImageStudioConfig = Schemastery.TypeT<typeof ImageStudioSchema>
type _IsMaxConcurrent = Expect<Equal<ImageStudioConfig['maxConcurrent'], number>>
// 元素级：三个预设数组曾退化为 any[]，这里钉住元素结构防复发
type _IsPromptId = Expect<Equal<ImageStudioConfig['promptPresets'][number]['id'], string>>
type _IsPresetEndpoint = Expect<
  Equal<ImageStudioConfig['paramPresets'][number]['endpoint'], 'generation' | 'edit'>
>
type _IsProviderModel = Expect<Equal<ImageStudioConfig['providerPresets'][number]['model'], string>>
type _IsProxy = Expect<Equal<ImageStudioConfig['proxy'], string>>
type _IsGalleryMax = Expect<Equal<ImageStudioConfig['galleryMaxItems'], number>>

// ── web-terminal：曾整体退化为 any（ConfigSchema: any），断言防复发 ──────────
type WebTerminalConfig = Schemastery.TypeT<typeof WebTerminalSchema>
type _WtEnabled = Expect<Equal<WebTerminalConfig['enabled'], boolean>>
type _WtMaxSessions = Expect<Equal<WebTerminalConfig['maxSessions'], number>>
type _WtShellArgs = Expect<Equal<WebTerminalConfig['shellArgs'], string[]>>
type _WtEnv = Expect<Equal<WebTerminalConfig['env'], Record<string, string>>>

export type {
  _AgAllowedIps,
  _AgEnabled,
  _AgTrustFwd,
  _IsGalleryMax,
  _IsMaxConcurrent,
  _IsPresetEndpoint,
  _IsPromptId,
  _IsProviderModel,
  _IsProxy,
  _LbCooldown,
  _LbEnabled,
  _LbPatchFile,
  _LpCatalogUrl,
  _LpEnabled,
  _LpRefreshHours,
  _NeDryRun,
  _NeEnabled,
  _NeTo,
  _RlEnabled,
  _RlGrace,
  _RlUnitName,
  _SelfTestAny,
  _SelfTestDifferent,
  _SelfTestSame,
  _SelfTestWiden,
  _SeMasked,
  _SeSecretName,
  _SmEnabled,
  _UpAutoSync,
  _UpCurrency,
  _UpPriceInput,
  _UpPriceProvider,
  _WtEnabled,
  _WtEnv,
  _WtMaxSessions,
  _WtShellArgs,
}
