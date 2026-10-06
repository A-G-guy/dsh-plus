/**
 * 官方应急副本的「官方可识别」契约与落盘行为：
 * 逐 route 过官方 Config schema 与官方 resolveProfiles、官方拒收的手写条目被
 * 剔除、手写条目来源（settings describe 视图）的降级、幂等跳写与外部删除自愈、
 * 空配置渲染空补丁。写盘路径注入临时目录，绝不触碰真实 $DSH_HOME。
 * @module @dsh-plus/llm-pi/tests/official-copy-contract
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type TestContext, test } from 'node:test'
import { Config as OfficialConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { parse } from 'yaml'

import type { LlmPiConfig } from '../src/config.ts'
import { OFFICIAL_COPY_PATH } from '../src/official-copy.ts'
import {
  createOfficialCopyWriter,
  type OfficialCopyWriterDeps,
  readManualProviders,
} from '../src/official-copy-writer.ts'
import { type DshKit, loadVendoredKit } from '../src/resolve-dsh.ts'

const kit: DshKit = loadVendoredKit()

/** 迁移场景配置：一个 pi 路由 + 一个 deepseek 路由。 */
function runtimeConfig(): LlmPiConfig {
  return {
    enabled: true,
    providers: {
      chat: {
        displayName: 'newapi(chat)',
        extends: 'deepseek',
        baseURL: 'https://gateway.example/v1',
        apiKeyEnv: 'TEST_KEY',
        defaultInput: ['text'],
        models: [{ id: 'deepseek-flash', extends: 'deepseek/deepseek-flash' }],
      },
      chatds: {
        adapter: 'deepseek',
        displayName: 'newapi(chatds)',
        apiKeyEnv: 'NEWAPI_API_KEY',
        baseURL: 'https://relay.example/v1',
        models: [{ id: 'deepseek-flash', name: 'Flash' }],
      },
    },
  }
}

/** 模拟 settings describe 的官方 llm-pi-ai 生效视图（schema 已解析、volatile 已物化）。 */
function manualFromOfficialSchema(): Record<string, unknown> {
  const parsed = OfficialConfig({
    providers: {
      gateway: {
        apiKeyEnv: 'GATEWAY_KEY',
        api: 'openai-completions',
        baseURL: 'https://gw.example/v1',
        models: [{ id: 'm1' }],
      },
    },
  }) as { providers: { get(): Record<string, unknown> } }
  return parsed.providers.get()
}

interface WriterHarness {
  deps: OfficialCopyWriterDeps
  path: string
}

/** 注入临时目录的写入器依赖；测试结束自动清理临时目录。 */
function harness(t: TestContext, overrides: Partial<OfficialCopyWriterDeps> = {}): WriterHarness {
  const dir = mkdtempSync(join(tmpdir(), 'llm-pi-copy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'llm-pi.official-patch.yaml')
  const deps: OfficialCopyWriterDeps = {
    kit,
    current: () => runtimeConfig(),
    readManual: () => ({ providers: manualFromOfficialSchema() }),
    profile: 'web',
    path,
    logger: { warn: () => {} },
    ...overrides,
  }
  return { deps, path }
}

/** 读取落盘副本的 llm-pi-ai providers 键集（无文件返回 null）。 */
function readProviders(path: string): Record<string, unknown> | null {
  const rows = parse(readFileSync(path, 'utf-8')) as Array<Record<string, unknown>>
  const row = rows.find((entry) => entry.id === 'llm-pi-ai')
  if (row === undefined) return null
  return (row.config as { providers: Record<string, unknown> }).providers
}

test('生成的副本逐 route 通过官方 Config 解析与官方 resolveProfiles', async (t) => {
  // Given —— pi + deepseek + 官方手写条目
  const { deps, path } = harness(t)
  // When —— 生成
  await createOfficialCopyWriter(deps).ensureOfficialCopy()
  // Then —— 三个 route 全部被官方校验接受并落盘
  const providers = readProviders(path)
  assert.ok(providers, '副本应已落盘')
  assert.deepEqual(Object.keys(providers).sort(), ['chat', 'chatds', 'gateway'])
  for (const [route, profile] of Object.entries(providers)) {
    assert.doesNotThrow(
      () => kit.officialConfig({ providers: { [route]: profile } }),
      `route "${route}" 应通过官方 Config 解析`,
    )
    assert.doesNotThrow(
      () => kit.resolveProfiles({ [route]: profile as never }),
      `route "${route}" 应通过官方可服务性链`,
    )
  }
  // 禁用行与结构
  const rows = parse(readFileSync(path, 'utf-8')) as Array<Record<string, unknown>>
  assert.deepEqual(rows[0], { id: 'dsh-plus-llm-pi', disabled: true })
})

test('官方拒收的手写条目：剔除该 route 并记警告，其余照常', async (t) => {
  // Given —— describe 视图里混入官方 schema 必拒的协议
  const badManual = { ...manualFromOfficialSchema(), bad: { api: 'bogus-protocol' } }
  const { deps, path } = harness(t, { readManual: () => ({ providers: badManual }) })
  // When —— 生成
  const writer = createOfficialCopyWriter(deps)
  await writer.ensureOfficialCopy()
  // Then —— bad 被剔除、有明确警告；合法 route 不受影响
  const providers = readProviders(path)
  assert.ok(providers)
  assert.equal(providers.bad, undefined)
  assert.ok(providers.gateway)
  const status = writer.status()
  assert.ok(status.warnings.some((w) => w.includes('"bad"') && w.includes('官方校验')))
  assert.equal(status.error, undefined)
})

test('手写条目来源降级：ns 缺失 / volatile 视图解包 / 读取失败各给出警告', () => {
  // Given —— describe 的三种形态
  const volatileView = { providers: { get: () => ({ fromRef: { api: 'openai-completions' } }) } }
  // When/Then —— ns 缺失
  const missing = readManualProviders({ describe: () => [] })
  assert.equal(missing.providers, undefined)
  assert.ok(missing.warning?.includes('未注册'))
  // When/Then —— volatile 活动引用被解包
  const unwrapped = readManualProviders({
    describe: () => [{ ns: 'llm-pi-ai', value: volatileView }],
  })
  assert.deepEqual(Object.keys(unwrapped.providers ?? {}), ['fromRef'])
  assert.equal(unwrapped.warning, undefined)
  // When/Then —— describe 抛错 → 降级而非失败
  const broken = readManualProviders({
    describe: () => {
      throw new Error('boom')
    },
  })
  assert.equal(broken.providers, undefined)
  assert.ok(broken.warning?.includes('boom'))
})

test('幂等跳写与外部删除自愈', async (t) => {
  // Given —— 已生成的副本
  const { deps, path } = harness(t)
  const writer = createOfficialCopyWriter(deps)
  await writer.ensureOfficialCopy()
  const first = readFileSync(path)
  const firstMtime = statSync(path).mtimeMs
  // When —— 配置未变再次生成
  await writer.ensureOfficialCopy()
  // Then —— 内容与 mtime 均未变（跳过写盘）
  assert.deepEqual(readFileSync(path), first)
  assert.equal(statSync(path).mtimeMs, firstMtime)
  // When —— 文件被外部删除
  rmSync(path)
  await writer.ensureOfficialCopy()
  // Then —— 下一次生成自愈落盘
  assert.ok(readProviders(path), '删除后应重新落盘')
})

test('空配置渲染空补丁并落盘（[]，无禁用行）', async (t) => {
  // Given —— 未配置任何 route
  const { deps, path } = harness(t, {
    current: () => ({ enabled: false, providers: {} }),
    readManual: () => ({}),
  })
  // When —— 生成
  await createOfficialCopyWriter(deps).ensureOfficialCopy()
  // Then —— 空补丁列表，无 dsh-plus-llm-pi 禁用行（避免「只禁用不供给」）
  const rows = parse(readFileSync(path, 'utf-8')) as unknown[]
  assert.deepEqual(rows, [])
})

test('默认落点在 .dsh 根目录（跨包文件契约）', () => {
  assert.ok(OFFICIAL_COPY_PATH.endsWith('/llm-pi.official-patch.yaml'))
  assert.ok(OFFICIAL_COPY_PATH.includes('/.dsh/'), '副本必须落在 Harness home 根')
})
