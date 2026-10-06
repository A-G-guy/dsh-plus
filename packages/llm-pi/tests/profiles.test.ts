/**
 * route 物化（normalizeRoute → kit.resolveProfiles）行为测试：
 * 继承/覆盖/compat 合并/协议与端点收敛/校验拒绝/宽松模式降级。
 * 模型目录唯一来自 pi-ai 内置目录（models.dev 兜底已移除）。
 * @module @dsh-plus/llm-pi/tests/profiles
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProviderProfileConfig } from '../src/config.ts'
import { THINKING_LEVELS } from '../src/config.ts'
import { buildProfiles } from '../src/profiles.ts'
import { type DshKit, loadVendoredKit } from '../src/resolve-dsh.ts'

const kit = loadVendoredKit()
const deps = { kit }

function modelsOf(profiles: ReturnType<typeof buildProfiles>, route: string) {
  const profile = profiles.get(route)
  assert.ok(profile, `route ${route} 应存在`)
  const piProvider = profile.piProvider
  assert.ok(piProvider, `route ${route} 的 piProvider 应已构建`)
  return { profile, models: piProvider.getModels() }
}

test('迁移场景：chat route 继承官方内置 + 自定义覆盖', () => {
  const providers: Record<string, ProviderProfileConfig> = {
    chat: {
      displayName: 'newapi(chat)',
      extends: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: 'TEST_KEY',
      models: [
        {
          id: 'deepseek-flash',
          extends: 'deepseek/deepseek-flash',
          reasoningEfforts: {
            low: 'low',
            high: 'high',
            xhigh: 'max',
            max: 'max',
          },
        },
        {
          id: 'deepseek-v4-pro',
          extends: 'deepseek/deepseek-v4-pro',
          contextWindow: 400000,
        },
      ],
    },
  }
  const { profile, models } = modelsOf(buildProfiles(providers, deps), 'chat')
  assert.equal(models.length, 2)

  const flash = models.find((m) => m.id === 'deepseek-flash')
  assert.ok(flash)
  // 继承：协议/compat/容量来自官方内置
  assert.equal(flash.api, 'openai-completions')
  assert.equal(flash.contextWindow, 1000000)
  assert.equal((flash.compat as Record<string, unknown>)['thinkingFormat'], 'deepseek')
  // route baseURL 覆盖内置端点
  assert.equal(flash.baseUrl, 'https://gateway.example/v1')
  // 覆盖：reasoningEfforts 全档位物化（未声明档位置 null，xhigh→max）
  assert.deepEqual(flash.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: 'low',
    medium: null,
    high: 'high',
    xhigh: 'max',
    max: 'max',
  })

  const pro = models.find((m) => m.id === 'deepseek-v4-pro')
  assert.ok(pro)
  // 覆盖：contextWindow 压过继承值；maxTokens 仍继承
  assert.equal(pro.contextWindow, 400000)
  assert.equal(pro.maxTokens, 384000)
  // 未显式配置 maxTokens → 不产生每请求默认 cap
  assert.equal(profile.configuredMaxTokens.size, 0)
  // 凭据引用物化
  assert.equal(String(profile.apiKeyEnv), 'TEST_KEY')
})

test('全量 compat：route 级 + 模型级逐字段合并并压过继承值', () => {
  const providers: Record<string, ProviderProfileConfig> = {
    chat: {
      extends: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      compat: { maxTokensField: 'max_tokens', supportsStore: true },
      models: [
        {
          id: 'deepseek-flash',
          compat: { supportsStore: false, requiresToolResultName: true },
        },
      ],
    },
  }
  const { models } = modelsOf(buildProfiles(providers, deps), 'chat')
  const compat = models[0]?.compat as Record<string, unknown>
  // 模型级压过 route 级；route 级补充；继承值保留
  assert.equal(compat['supportsStore'], false)
  assert.equal(compat['maxTokensField'], 'max_tokens')
  assert.equal(compat['requiresToolResultName'], true)
  assert.equal(compat['thinkingFormat'], 'deepseek')
})

test('compat 未知键在构建期拒绝（官方门控：未知键/withhold 均写时拒绝）', () => {
  const providers: Record<string, ProviderProfileConfig> = {
    chat: {
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
      models: [{ id: 'm', compat: { notARealField: true } }],
    },
  }
  assert.throws(
    () => buildProfiles(providers, deps),
    /compat\.notARealField 不是 openai-completions 协议的合法字段/,
  )
  // 官方 withhold 字段（旧版可配）同样写时拒绝
  assert.throws(
    () =>
      buildProfiles(
        {
          chat: {
            baseURL: 'https://gateway.example/v1',
            api: 'openai-completions',
            models: [{ id: 'm', compat: { zaiToolStream: false } }],
          },
        },
        deps,
      ),
    /withhold/,
  )
})

test('provider 级 extends 且不写 models：继承源全部模型', () => {
  const providers: Record<string, ProviderProfileConfig> = {
    anthropic: { extends: 'kimi-coding', baseURL: 'https://gateway.example' },
  }
  const { models } = modelsOf(buildProfiles(providers, deps), 'anthropic')
  const ids = models.map((m) => m.id)
  assert.ok(ids.includes('k3') && ids.includes('k3-256k'))
  const k3 = models.find((m) => m.id === 'k3')
  const k3Compat = k3?.compat as Record<string, unknown> | undefined
  // anthropic 协议 compat 随继承保留
  assert.equal(k3Compat?.['forceAdaptiveThinking'], true)
  assert.equal(k3?.api, 'anthropic-messages')
})

test('provider 级 extends 不是内置 provider 时写时拒绝（不再静默退化为手写条目）', () => {
  const providers: Record<string, ProviderProfileConfig> = {
    chat: { extends: 'acme-lab', baseURL: 'https://g.example/v1', models: [{ id: 'm' }] },
  }
  assert.throws(
    () => buildProfiles(providers, deps),
    /extends "acme-lab" 不是 pi-ai .* 的内置 provider；可用：/,
  )
  // lenient（运行期）：告警并忽略该继承源；无 api 来源 → 该 route 当前不可服务而跳过
  const warnings: string[] = []
  const skipped = buildProfiles(providers, {
    ...deps,
    lenient: true,
    warn: (m) => warnings.push(m),
  })
  assert.equal(skipped.has('chat'), false)
  assert.ok(warnings.some((m) => /不是当前 pi-ai 的内置 provider/.test(m)))
  assert.ok(warnings.some((m) => /已跳过该 route/.test(m)))
})

test('provider 级 extends 无效但 route 自备 api/baseURL 时，lenient 下降级为手写条目', () => {
  const warnings: string[] = []
  const { models } = modelsOf(
    buildProfiles(
      {
        chat: {
          extends: 'acme-lab',
          api: 'openai-completions',
          baseURL: 'https://g.example/v1',
          models: [{ id: 'm' }],
        },
      },
      { ...deps, lenient: true, warn: (m) => warnings.push(m) },
    ),
    'chat',
  )
  assert.equal(models.length, 1)
  assert.equal(models[0]?.api, 'openai-completions')
  assert.equal(models[0]?.baseUrl, 'https://g.example/v1')
  assert.ok(warnings.some((m) => /不是当前 pi-ai 的内置 provider/.test(m)))
})

test('手写 route：无继承源时必填字段缺失即报错，给全则可服务', () => {
  assert.throws(() => buildProfiles({ g: { models: [{ id: 'm' }] } }, deps), /需要 api/)
  const { models } = modelsOf(
    buildProfiles(
      {
        g: {
          api: 'openai-completions',
          baseURL: 'https://g.example/v1',
          models: [{ id: 'm' }],
        },
      },
      deps,
    ),
    'g',
  )
  assert.equal(models[0]?.contextWindow, 262144)
  assert.deepEqual(models[0]?.input, ['text'])
  assert.equal(models[0]?.reasoning, false)
})

test('route 内协议不一致被拒绝', () => {
  const providers: Record<string, ProviderProfileConfig> = {
    mixed: {
      baseURL: 'https://gateway.example/v1',
      models: [
        { id: 'a', extends: 'deepseek/deepseek-flash' },
        { id: 'b', extends: 'kimi-coding/k3' },
      ],
    },
  }
  assert.throws(() => buildProfiles(providers, deps), /route 内模型协议不一致/)
})

test('协议不在当前生效集合内时写时拒绝，错误里带生效版本与支持集合', () => {
  assert.throws(
    () =>
      buildProfiles(
        {
          g: {
            api: 'grpc-whatever',
            baseURL: 'https://g.example/v1',
            models: [{ id: 'm' }],
          },
        },
        deps,
      ),
    /api "grpc-whatever" 本插件无法服务（当前生效 pi-ai .* 支持的协议：/,
  )
})

test('官方必需字段：requestImagePixelBudget/requestImageMaxBytes 缺省取官方默认，显式配置透传', () => {
  const { profile } = modelsOf(
    buildProfiles(
      {
        g: {
          api: 'openai-completions',
          baseURL: 'https://g.example/v1',
          models: [{ id: 'm' }],
        },
      },
      deps,
    ),
    'g',
  )
  // 官方 DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET / DEFAULT_REQUEST_IMAGE_MAX_BYTES
  assert.equal(profile.maxRequestImageBytes, 20 * 1024 * 1024)
  assert.equal(profile.requestImagePixelBudget, 2048 * 2048)
  assert.equal(profile.requestImageMaxBytes, 1024 * 1024)
  const { profile: overridden } = modelsOf(
    buildProfiles(
      {
        g: {
          api: 'openai-completions',
          baseURL: 'https://g.example/v1',
          maxRequestImageBytes: 1048576,
          requestImagePixelBudget: 1024 * 1024,
          requestImageMaxBytes: 262144,
          models: [{ id: 'm' }],
        },
      },
      deps,
    ),
    'g',
  )
  assert.equal(overridden.maxRequestImageBytes, 1048576)
  assert.equal(overridden.requestImagePixelBudget, 1024 * 1024)
  assert.equal(overridden.requestImageMaxBytes, 262144)
})

test('继承 reasoning 能力物化为显式档位字典（与内置目录语义逐档位一致）', () => {
  const builtinMap = kit
    .getBuiltinModels('deepseek')
    .find((m) => m.id === 'deepseek-v4-pro')?.thinkingLevelMap
  assert.ok(builtinMap, 'deepseek-v4-pro 应有内置 thinkingLevelMap')
  const { models } = modelsOf(
    buildProfiles(
      {
        chat: {
          extends: 'deepseek',
          baseURL: 'https://g.example/v1',
          models: [{ id: 'deepseek-v4-pro' }],
        },
      },
      deps,
    ),
    'chat',
  )
  const pro = models.find((m) => m.id === 'deepseek-v4-pro')
  assert.ok(pro)
  assert.equal(pro.reasoning, true)
  // 语义等价断言：支持档位集合与线值一致。builtin 缺省档位 = 支持且线值取档位名
  // （pi-ai dispatch 的 map?.[level] ?? level）；xhigh/max 缺省 = 不支持（null）。
  for (const level of THINKING_LEVELS) {
    const expected: string | null | undefined = builtinMap[level]
    const actual: string | null | undefined = pro.thinkingLevelMap?.[level]
    if (expected === undefined) {
      if (level === 'xhigh' || level === 'max') assert.equal(actual, null)
      else assert.equal(actual, level)
    } else {
      assert.equal(actual, expected)
    }
  }
})

test('官方模型条目字段集是运行期推导的：官方新增字段随继承自动透传', () => {
  // 造一个"官方 schema 多了一个模型级字段、且 pi-ai 目录也给出该字段"的套件：
  // 官方其实已经支持 Model.samplingParams，这里模拟它被写进模型条目 schema 的情形。
  const base = loadVendoredKit()
  const patched = base.getBuiltinModels('deepseek').map((model) =>
    model.id === 'deepseek-flash'
      ? ({ ...model, samplingParams: { temperature: 0.3 } } as typeof model & {
          samplingParams: Record<string, unknown>
        })
      : model,
  )
  const fakeKit: DshKit = {
    ...base,
    officialModelFields: [...base.officialModelFields, 'samplingParams'],
    getBuiltinModels: ((provider: string) =>
      provider === 'deepseek'
        ? patched
        : base.getBuiltinModels(provider as never)) as DshKit['getBuiltinModels'],
  }
  const { models } = modelsOf(
    buildProfiles(
      {
        chat: {
          extends: 'deepseek',
          baseURL: 'https://g.example/v1',
          models: [{ id: 'deepseek-flash' }],
        },
      },
      { kit: fakeKit },
    ),
    'chat',
  )
  assert.deepEqual((models[0] as unknown as Record<string, unknown>)['samplingParams'], {
    temperature: 0.3,
  })
  // 字段集里没有的目录字段不会进条目（官方 schema 不接受就不透传）
  assert.equal((models[0] as unknown as Record<string, unknown>)['inputLimits'], undefined)
})

test('enabled 之外的基本校验：空 baseURL / 空 defaultInput / 坏 idle timeout', () => {
  assert.throws(
    () => buildProfiles({ g: { baseURL: '', models: [{ id: 'm' }] } }, deps),
    /baseURL 为空/,
  )
  assert.throws(
    () =>
      buildProfiles(
        {
          g: {
            api: 'openai-completions',
            baseURL: 'https://g.example',
            defaultInput: [],
            models: [{ id: 'm' }],
          },
        },
        deps,
      ),
    /defaultInput 至少要声明一种模态/,
  )
  assert.throws(
    () =>
      buildProfiles(
        {
          g: {
            api: 'openai-completions',
            baseURL: 'https://g.example',
            streamIdleTimeoutMs: -1,
            models: [{ id: 'm' }],
          },
        },
        deps,
      ),
    /streamIdleTimeoutMs/,
  )
})

test('lenient 模式：extends 引用失效（目录漂移）时降级为手写条目并告警，不抛错', () => {
  const providers: Record<string, ProviderProfileConfig> = {
    myroute: {
      api: 'openai-completions',
      baseURL: 'https://g.example/v1',
      models: [{ id: 'acme-huge', extends: 'acme-lab/acme-huge' }],
    },
  }
  // 严格模式（写时校验）：拒绝
  assert.throws(
    () => buildProfiles(providers, deps),
    /extends 引用 "acme-lab\/acme-huge" 不在 pi-ai .* 的内置目录中/,
  )
  // lenient 模式（运行期）：降级手写条目 + 告警，route 照常可服务
  const warnings: string[] = []
  const { models: degraded } = modelsOf(
    buildProfiles(providers, { ...deps, lenient: true, warn: (m) => warnings.push(m) }),
    'myroute',
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /已降级为手写条目/)
  // 降级后：字段退化（默认容量/text-only），route 级 api/baseURL 补足
  assert.equal(degraded[0]?.contextWindow, 262144)
  assert.deepEqual(degraded[0]?.input, ['text'])
  assert.equal(degraded[0]?.baseUrl, 'https://g.example/v1')
})

test('lenient 模式：降级后仍缺 api/baseURL 的 route 被跳过，不注册', () => {
  const warnings: string[] = []
  const resolved = buildProfiles(
    {
      g: { models: [{ id: 'x', extends: 'acme-lab/acme-huge' }] },
    },
    { ...deps, lenient: true, warn: (m) => warnings.push(m) },
  )
  assert.equal(resolved.has('g'), false)
  assert.ok(warnings.some((m) => /已跳过该模型/.test(m)))
  assert.ok(warnings.some((m) => /已跳过该 route/.test(m)))
})

test('lenient 模式：个别模型失效不影响同 route 其余模型', () => {
  const warnings: string[] = []
  const { models } = modelsOf(
    buildProfiles(
      {
        chat: {
          baseURL: 'https://g.example/v1',
          models: [
            { id: 'deepseek-flash', extends: 'deepseek/deepseek-flash' },
            { id: 'gone', extends: 'acme-lab/acme-huge' },
          ],
        },
      },
      { ...deps, lenient: true, warn: (m) => warnings.push(m) },
    ),
    'chat',
  )
  // 内置命中的模型保留；失效引用降级（route 有 api 推导，仍可服务）
  assert.ok(models.some((m) => m.id === 'deepseek-flash'))
  assert.ok(models.some((m) => m.id === 'gone'))
  assert.ok(warnings.some((m) => /已降级为手写条目/.test(m)))
})
