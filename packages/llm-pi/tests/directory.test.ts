import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ModelsDevSource } from '../src/catalog/models-dev.ts'
import { buildDirectoryEntries, commitDirectory, type DirectoryEntry } from '../src/directory.ts'
import { assertServiceable, buildProfiles } from '../src/profiles.ts'
import { loadVendoredKit } from '../src/resolve-dsh.ts'

function entry(provider: string): DirectoryEntry {
  return {
    provider,
    displayName: provider,
    settingsNs: 'dsh-plus-llm-pi',
    settingsPath: ['providers', provider],
    declared: true,
  }
}

/** 模拟官方目录：anthropic 已被既有注册占用，整批原子拒绝。 */
function registerWithConflict(held: string[]) {
  const batches: string[][] = []
  return {
    batches,
    register: (entries: DirectoryEntry[]) => {
      batches.push(entries.map((e) => e.provider))
      const hit = entries.find((e) => held.includes(e.provider))
      if (hit) {
        const error = new Error(`configurable provider "${hit.provider}" is already declared`)
        error.name = 'LlmError'
        throw error
      }
    },
  }
}

test('整批被拒时剔除冲突条目重试，其余条目照常注册', () => {
  // Given —— 官方目录已声明 anthropic（内置 provider）
  const { batches, register } = registerWithConflict(['anthropic'])
  const warnings: string[] = []
  // When —— 提交 [chat, anthropic, chatds]
  commitDirectory(register, [entry('chat'), entry('anthropic'), entry('chatds')], (m) =>
    warnings.push(m),
  )
  // Then —— 首轮整批被拒，剔除 anthropic 后次轮成功；告警点名冲突条目
  assert.deepEqual(batches, [
    ['chat', 'anthropic', 'chatds'],
    ['chat', 'chatds'],
  ])
  assert.ok(warnings.some((m) => m.includes('"anthropic"')))
})

test('非冲突错误原样上抛，不做无限重试', () => {
  const register = () => {
    throw new Error('some other failure')
  }
  assert.throws(() => commitDirectory(register, [entry('chat')], () => {}), /some other failure/)
})

test('冲突消息匹配但剔除无效（防死循环护栏）时上抛原错误', () => {
  // 构造一个永远报同名冲突的注册器（剔除后仍报同名）
  const register = () => {
    throw new Error('configurable provider "ghost" is already declared')
  }
  assert.throws(() => commitDirectory(register, [entry('chat')], () => {}), /already declared/)
})

test('草稿路由（无 models 无 extends）进目录条目，displayName 缺省回退路由名', () => {
  const kit = loadVendoredKit()
  const entries = buildDirectoryEntries(kit, 'dsh-plus-llm-pi', new Map(), new Map(), [
    { route: 'newapi-chat', displayName: 'newapi(chat)' },
    { route: 'bare-draft', displayName: 'bare-draft' },
  ])
  assert.deepEqual(
    entries.map((e) => [e.provider, e.displayName, e.declared]),
    [
      ['newapi-chat', 'newapi(chat)', true],
      ['bare-draft', 'bare-draft', true],
    ],
  )
})

test('草稿路由被 buildProfiles 跳过（不进 adapter），写时校验不拒绝', () => {
  const kit = loadVendoredKit()
  const modelsDev = new ModelsDevSource(
    '/tmp/nonexistent-draft-test.json',
    'http://127.0.0.1:1/x',
    0,
    () => {},
  )
  const providers = {
    'newapi-chat': { displayName: 'newapi(chat)' },
    'newapi-response': {
      displayName: 'newapi(response)',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:1/v1',
      apiKeyEnv: 'K',
      models: [{ id: 'gpt-5.6-sol' }],
    },
  }
  const profiles = buildProfiles(providers, { kit, modelsDev })
  // Given 草稿 + 正常路由 —— When 物化 —— Then 草稿跳过、正常路由照常
  assert.equal(profiles.has('newapi-chat'), false)
  assert.ok(profiles.has('newapi-response'))
  // 严格写时校验同样放行草稿
  assertServiceable(providers, { kit, modelsDev })
})
