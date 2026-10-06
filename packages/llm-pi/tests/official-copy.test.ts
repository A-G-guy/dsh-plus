/**
 * 官方应急副本的翻译与渲染行为（纯函数域）：
 * pi 路由物化改写 / compat offer 过滤 / deepseek 路由映射与未迁移告警 /
 * 草稿与坏 route 的警告 / 手写条目覆盖 / 头注释与空补丁渲染。
 * @module @dsh-plus/llm-pi/tests/official-copy
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { parse } from 'yaml'

import type { ProviderProfileConfig } from '../src/config.ts'
import {
  buildOfficialCopy,
  deriveOfficialRouteFields,
  FALLBACK_ROUTE_FIELDS,
  OFFICIAL_COPY_PATH,
  type OfficialCopyInput,
  renderOfficialCopy,
} from '../src/official-copy.ts'
import { normalizeOfficialRoutes } from '../src/profiles.ts'
import { buildDeepseekRoutes } from '../src/profiles-deepseek.ts'
import { type DshKit, loadVendoredKit } from '../src/resolve-dsh.ts'

const kit: DshKit = loadVendoredKit()
/** 官方 schema 现场推导；失败回退内置键集（推导断言见文件尾单测）。 */
const routeFields = deriveOfficialRouteFields(kit.officialConfig) ?? [...FALLBACK_ROUTE_FIELDS]

/** 用运行期同款链装配一份副本输入（raw 配置 → 物化 → 翻译前的两份产物）。 */
function inputs(
  providers: Record<string, ProviderProfileConfig>,
  manualProviders?: Record<string, unknown>,
  warn: (message: string) => void = () => {},
): OfficialCopyInput {
  return {
    providers,
    normalizedPi: normalizeOfficialRoutes(providers, { kit, lenient: true, warn }),
    deepseekResolved: buildDeepseekRoutes(providers, { kit, lenient: true, warn }),
    manualProviders,
    routeFields,
    modelFields: kit.officialModelFields,
  }
}

/** 迁移场景的 pi 路由（继承官方内置目录 + 自定义覆盖）。 */
function piProviders(): Record<string, ProviderProfileConfig> {
  return {
    chat: {
      displayName: 'newapi(chat)',
      extends: 'deepseek',
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: 'TEST_KEY',
      defaultInput: ['text'],
      models: [{ id: 'deepseek-flash', extends: 'deepseek/deepseek-flash' }],
    },
  }
}

test('pi 路由改写为官方形状：字段白名单过滤，模型继承全物化、extends 消失', () => {
  // Given —— 带 extends 与插件专有字段的原始配置
  const providers = piProviders()
  providers.chat = { ...providers.chat, adapter: 'pi' }
  // When —— 翻译
  const copy = buildOfficialCopy(inputs(providers))
  // Then —— route 只剩官方字段，模型条目全显式（官方无 extends）
  const route = copy.providers.chat as Record<string, unknown>
  assert.ok(route, 'chat 应在副本内')
  assert.equal(route.api, 'openai-completions')
  assert.equal(route.apiKeyEnv, 'TEST_KEY')
  assert.equal(route.displayName, 'newapi(chat)')
  assert.equal(route.adapter, undefined, 'adapter 是插件专有字段，不得进副本')
  assert.equal(route.extends, undefined, 'route 级 extends 必须消失')
  const models = route.models as Array<Record<string, unknown>>
  assert.equal(models.length, 1)
  const model = models[0] as Record<string, unknown>
  assert.equal(model.id, 'deepseek-flash')
  assert.equal(model.extends, undefined, '模型条目不得携带 extends')
  assert.equal(typeof model.contextWindow, 'number', 'contextWindow 应已从目录物化')
  assert.ok(Array.isArray(model.input) || model.input === undefined)
  const compat = model.compat as Record<string, unknown> | undefined
  assert.equal(compat?.thinkingFormat, 'deepseek', 'offer 字段应保留')
  assert.deepEqual(copy.warnings, [])
})

test('compat 过滤只留 offer：withhold 与未知键被丢弃', () => {
  // Given —— 目录继承可能携带的 withhold 键与未知键
  const normalizedPi = new Map<string, PiAiProviderProfile>([
    [
      'gate',
      {
        displayName: 'gate',
        api: 'openai-completions',
        baseURL: 'https://gw.example/v1',
        apiKeyEnv: 'K',
        models: [
          {
            id: 'm',
            // 故意混入 withhold 与未知键（目录继承可能携带）：类型面经断言绕开
            compat: {
              supportsStore: true,
              openRouterRouting: true,
              futureField: 1,
            } as unknown as Record<string, unknown>,
          },
        ],
      } as PiAiProviderProfile,
    ],
  ])
  // When —— 翻译（raw 键占位，normalizedPi 手工夹具直供）
  const copy = buildOfficialCopy({
    providers: { gate: {} },
    normalizedPi,
    deepseekResolved: new Map(),
    manualProviders: undefined,
    routeFields,
    modelFields: kit.officialModelFields,
  })
  // Then —— 只剩该协议 offer 的字段
  const model = (copy.providers.gate as { models: Array<Record<string, unknown>> }).models[0]
  assert.ok(model)
  assert.deepEqual(model.compat, { supportsStore: true })
})

test('deepseek 路由改写为 openai-completions，未迁移字段逐项告警', () => {
  // Given —— 文件通道与思考配置齐全的 deepseek 路由
  const warnings: string[] = []
  const providers: Record<string, ProviderProfileConfig> = {
    chatds: {
      adapter: 'deepseek',
      displayName: 'newapi(chatds)',
      apiKeyEnv: 'NEWAPI_API_KEY',
      baseURL: 'https://relay.example/v1',
      thinking: 'enabled',
      reasoningEffort: 'high',
      filesApiTimeoutMs: 60_000,
      models: [{ id: 'deepseek-flash', name: 'Flash' }],
    },
  }
  // When —— 翻译
  const copy = buildOfficialCopy(inputs(providers, undefined, (m) => warnings.push(m)))
  // Then —— 官方 llm-pi-ai 形状 + 显式告警（绝不静默丢弃）
  const route = copy.providers.chatds as Record<string, unknown>
  assert.equal(route.api, 'openai-completions')
  assert.equal(route.displayName, 'newapi(chatds)')
  assert.equal(route.apiKeyEnv, 'NEWAPI_API_KEY')
  assert.equal(route.baseURL, 'https://relay.example/v1')
  assert.equal(typeof route.defaultMaxTokens, 'number')
  assert.equal(typeof route.defaultContextWindow, 'number')
  const models = route.models as Array<Record<string, unknown>>
  assert.equal(models[0]?.id, 'deepseek-flash')
  assert.equal(models[0]?.name, 'Flash')
  assert.equal(route.filePolicy, undefined, '文件通道配置不得进副本')
  assert.equal(route.thinking, undefined, 'deepseek 思考配置不迁移')
  const unmigrated = copy.warnings.find((w) => w.includes('未迁移'))
  assert.ok(unmigrated, '应有未迁移告警')
  assert.ok(unmigrated.includes('thinking'))
  assert.ok(unmigrated.includes('reasoningEffort'))
  assert.ok(unmigrated.includes('filesApiTimeoutMs'))
  assert.deepEqual(warnings, [], '该 route 物化本身不应失败')
})

test('草稿 route 与不可物化 route 只产生警告，不产出条目', () => {
  // Given —— 草稿（无模型占位）与非法协议
  const warnings: string[] = []
  const providers: Record<string, ProviderProfileConfig> = {
    draft: {},
    broken: {
      api: 'no-such-protocol' as string,
      baseURL: 'https://x.example/v1',
      models: [{ id: 'm' }],
    },
  }
  // When —— 翻译
  const copy = buildOfficialCopy(inputs(providers, undefined, (m) => warnings.push(m)))
  // Then —— 两者都不在副本，且各有说明
  assert.deepEqual(Object.keys(copy.providers), [])
  assert.ok(copy.warnings.some((w) => w.includes('草稿 route "draft"')))
  assert.ok(
    warnings.some((w) => w.includes('"broken"')),
    '坏 route 的物化失败应经 warn 通道报告',
  )
})

test('手写官方条目合并进副本，同名 key 手写优先', () => {
  // Given —— 本插件 route "shared" 与官方手写条目同名
  const copy = buildOfficialCopy(
    inputs(piProviders(), { shared: { displayName: '手写', api: 'openai-completions' } }),
  )
  // When —— 补一份本插件的 "shared"
  const withShared = buildOfficialCopy({
    ...inputs(piProviders(), { shared: { displayName: '手写' } }),
    normalizedPi: new Map([
      ...normalizeOfficialRoutes(piProviders(), { kit, lenient: true }),
      ['shared', { displayName: '插件', api: 'openai-completions' } as PiAiProviderProfile],
    ]),
  })
  // Then —— 手写覆盖插件值；未冲突的手写条目原样并入
  assert.equal((withShared.providers.shared as { displayName: string }).displayName, '手写')
  assert.equal((copy.providers.shared as { displayName: string }).displayName, '手写')
  assert.ok(copy.providers.chat, '未冲突的插件 route 照常保留')
})

test('渲染：patch 行结构、头注释含应用指引与警告、输出确定性', () => {
  // Given —— 一份带警告的副本
  const copy = buildOfficialCopy(inputs(piProviders(), undefined))
  copy.warnings.push('测试警告')
  // When —— 渲染两次
  const first = renderOfficialCopy(copy, { profile: 'web' })
  const second = renderOfficialCopy(copy, { profile: 'web' })
  // Then —— 确定性输出；头注释含两种应用方式与警告
  assert.equal(first, second, '同输入必须同字节（mtime 承载时间语义）')
  assert.ok(first.includes(`#   1) 单次启动：dsh web --patch ${OFFICIAL_COPY_PATH}`))
  assert.ok(first.includes('#   2) 长期生效：'))
  assert.ok(first.includes('# 警告：测试警告'))
  // Then —— 结构：禁用行 + llm-pi-ai 行，providers 与翻译结果一致
  const rows = parse(first) as Array<Record<string, unknown>>
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { id: 'dsh-plus-llm-pi', disabled: true })
  assert.equal(rows[1]?.id, 'llm-pi-ai')
  const config = rows[1]?.config as { providers: Record<string, unknown> }
  assert.deepEqual(Object.keys(config.providers), ['chat'])
})

test('零 route 渲染为空补丁：绝不产出「只禁用不供给」的误导副本', () => {
  // Given —— 没有任何可迁移 route
  const content = renderOfficialCopy({ providers: {}, warnings: [] }, { profile: 'web' })
  // Then —— [] 空补丁 + 说明注释
  assert.deepEqual(parse(content), [])
  assert.ok(content.includes('空补丁应用无效果'))
})

test('route 字段推导：官方 schema 可推导，失败回退内置键集', () => {
  // Given/When —— 现场推导与兜底键集
  const derived = deriveOfficialRouteFields(kit.officialConfig)
  assert.ok(derived !== undefined, '官方 Config schema 应可推导 route 字段')
  assert.ok(derived.includes('baseURL'))
  assert.ok(derived.includes('models'))
  // Then —— 兜底键集覆盖推导键集的全部核心字段（防两表漂移）
  for (const field of ['apiKeyEnv', 'api', 'baseURL', 'models', 'retryPolicy']) {
    assert.ok((FALLBACK_ROUTE_FIELDS as readonly string[]).includes(field))
  }
})
