import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ModelsDevSource } from '../src/catalog/models-dev.ts'
import type { ProviderProfileConfig } from '../src/config.ts'
import { THINKING_LEVELS } from '../src/config.ts'
import { buildProfiles } from '../src/profiles.ts'
import { loadVendoredKit } from '../src/resolve-dsh.ts'

const kit = loadVendoredKit()
const deps = { kit }

function modelsOf(profiles: ReturnType<typeof buildProfiles>, route: string) {
  const profile = profiles.get(route)
  assert.ok(profile, `route ${route} 应存在`)
  return { profile, models: profile.piProvider.getModels() }
}

/** 带 fixtures 的 models.dev 源（缓存文件即数据源，TTL 内不触网）。 */
async function fixtureModelsDev(): Promise<ModelsDevSource> {
  const dir = mkdtempSync(join(tmpdir(), 'llm-pi-profile-test-'))
  const file = join(dir, 'models-dev.json')
  writeFileSync(
    file,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      data: {
        'acme-lab': {
          id: 'acme-lab',
          models: {
            'acme-huge': {
              id: 'acme-huge',
              name: 'Acme Huge',
              reasoning: true,
              limit: { context: 512000, output: 64000 },
            },
          },
        },
      },
    }),
  )
  const source = new ModelsDevSource(file, 'http://127.0.0.1:1/unreachable', 24, () => {})
  await source.ensureLoaded()
  return source
}

/** 无数据源的 models.dev 实例（模拟拉取失败/漂移后的状态）。 */
async function emptyModelsDev(): Promise<ModelsDevSource> {
  const dir = mkdtempSync(join(tmpdir(), 'llm-pi-profile-test-'))
  const source = new ModelsDevSource(
    join(dir, 'models-dev.json'),
    'http://127.0.0.1:1/unreachable',
    0,
    () => {},
  )
  await source.ensureLoaded()
  return source
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
          id: 'deepseek-v4-flash',
          extends: 'deepseek/deepseek-v4-flash',
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

  const flash = models.find((m) => m.id === 'deepseek-v4-flash')
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
          id: 'deepseek-v4-flash',
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
        { id: 'a', extends: 'deepseek/deepseek-v4-flash' },
        { id: 'b', extends: 'kimi-coding/k3' },
      ],
    },
  }
  assert.throws(() => buildProfiles(providers, deps), /route 内模型协议不一致/)
})

test('0.1.2-alpha.1 必需字段：requestImagePixelBudget/requestImageMaxBytes 缺省取官方默认，显式配置透传', () => {
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

test('pi 路由含 imageDetail 写时拒绝并提示迁移（schema 透传陷阱）', () => {
  assert.throws(
    () =>
      buildProfiles(
        {
          g: {
            api: 'openai-completions',
            baseURL: 'https://g.example/v1',
            models: [{ id: 'm', imageDetail: 'low' as never }],
          },
        },
        deps,
      ),
    /imageDetail 已随 0.1.2-alpha.1 移除/,
  )
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
    const expected = builtinMap[level]
    const actual = pro.thinkingLevelMap?.[level]
    if (expected === undefined) {
      if (level === 'xhigh' || level === 'max') assert.equal(actual, null)
      else assert.equal(actual, level)
    } else {
      assert.equal(actual, expected)
    }
  }
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

test('lenient 模式：extends 引用失效（数据源漂移）时降级为手写条目并告警，不抛错', async () => {
  const modelsDev = await fixtureModelsDev()
  const providers: Record<string, ProviderProfileConfig> = {
    myroute: {
      api: 'openai-completions',
      baseURL: 'https://g.example/v1',
      models: [{ id: 'acme-huge', extends: 'acme-lab/acme-huge' }],
    },
  }
  // 数据源在时：models-dev 命中，字段保守
  const { models: hitModels } = modelsOf(buildProfiles(providers, { kit, modelsDev }), 'myroute')
  assert.equal(hitModels[0]?.contextWindow, 512000)
  assert.equal(hitModels[0]?.reasoning, true)
  // 数据源失效（模拟漂移）：严格模式（写时校验）拒绝
  const empty = await emptyModelsDev()
  assert.throws(
    () => buildProfiles(providers, { kit, modelsDev: empty }),
    /extends 引用 "acme-lab\/acme-huge" 在内置目录与 models.dev 快照中都不存在/,
  )
  // lenient 模式（运行期）：降级手写条目 + 告警，route 照常可服务
  const warnings: string[] = []
  const { models: degraded } = modelsOf(
    buildProfiles(providers, {
      kit,
      modelsDev: empty,
      lenient: true,
      warn: (m) => warnings.push(m),
    }),
    'myroute',
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /已降级为手写条目/)
  // 降级后：字段退化（默认容量/text-only），route 级 api/baseURL 补足
  assert.equal(degraded[0]?.contextWindow, 262144)
  assert.deepEqual(degraded[0]?.input, ['text'])
  assert.equal(degraded[0]?.baseUrl, 'https://g.example/v1')
})

test('lenient 模式：降级后仍缺 api/baseURL 的 route 被跳过，不注册', async () => {
  const empty = await emptyModelsDev()
  const warnings: string[] = []
  const resolved = buildProfiles(
    {
      g: { models: [{ id: 'x', extends: 'acme-lab/acme-huge' }] },
    },
    { kit, modelsDev: empty, lenient: true, warn: (m) => warnings.push(m) },
  )
  assert.equal(resolved.has('g'), false)
  assert.ok(warnings.some((m) => /已跳过该模型/.test(m)))
  assert.ok(warnings.some((m) => /已跳过该 route/.test(m)))
})

test('lenient 模式：个别模型失效不影响同 route 其余模型', async () => {
  const empty = await emptyModelsDev()
  const warnings: string[] = []
  const { models } = modelsOf(
    buildProfiles(
      {
        chat: {
          baseURL: 'https://g.example/v1',
          models: [
            { id: 'deepseek-v4-flash', extends: 'deepseek/deepseek-v4-flash' },
            { id: 'gone', extends: 'acme-lab/acme-huge' },
          ],
        },
      },
      { kit, modelsDev: empty, lenient: true, warn: (m) => warnings.push(m) },
    ),
    'chat',
  )
  // 内置命中的模型保留；失效的 models-dev 引用降级（route 有 api 推导，仍可服务）
  assert.ok(models.some((m) => m.id === 'deepseek-v4-flash'))
  assert.ok(models.some((m) => m.id === 'gone'))
  assert.ok(warnings.some((m) => /已降级为手写条目/.test(m)))
})
