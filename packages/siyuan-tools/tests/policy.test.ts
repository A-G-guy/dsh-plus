import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import { Config, type SiyuanToolsConfig } from '../src/config.ts'
import {
  askDisplayReason,
  askReason,
  classifyPolicy,
  effectiveApprovalPolicy,
  policySettingsOf,
  registerPolicy,
} from '../src/policy.ts'

/** 以 schema 补默认得到子插件配置。 */
function configWith(overrides: Partial<SiyuanToolsConfig> = {}): SiyuanToolsConfig {
  return { ...Config({}), ...overrides } as SiyuanToolsConfig
}

interface FakeApproval {
  config: { policy?: 'ask' | 'never' | undefined }
  overrideOf(session: unknown): 'ask' | 'never' | undefined
}

/** pre-execute 监听捕获替身；approval = undefined 模拟无审批服务。 */
function fakeCtx(approval?: FakeApproval): {
  ctx: Context
  handlers: ((exec: unknown, next: () => Promise<unknown>) => unknown)[]
} {
  const handlers: ((exec: unknown, next: () => Promise<unknown>) => unknown)[] = []
  const ctx = {
    on(_event: string, fn: (exec: unknown, next: () => Promise<unknown>) => unknown) {
      handlers.push(fn)
      return () => {}
    },
    get(key: string) {
      return key === 'approval' ? approval : undefined
    },
  } as unknown as Context
  return { ctx, handlers }
}

const ALLOW_NEXT = async () => ({ kind: 'allow' as const })

test('given the default policy, when classifying actions, then reads allow and writes ask', () => {
  const settings = policySettingsOf(configWith())
  assert.equal(classifyPolicy('document', { action: 'get' }, settings), 'allow')
  assert.equal(classifyPolicy('block', { action: 'batch_get' }, settings), 'allow')
  assert.equal(classifyPolicy('document', { action: 'create' }, settings), 'ask')
  assert.equal(classifyPolicy('document', { action: 'move' }, settings), 'ask')
  assert.equal(classifyPolicy('notebook', { action: 'set_icon' }, settings), 'ask')
})

test('given alwaysAsk families, when classifying, then egress and filesystem tools ask even for reads', () => {
  const settings = policySettingsOf(configWith())
  assert.equal(
    classifyPolicy('sync', { action: 'status' }, settings),
    'ask',
    '整工具名单优先于读白名单',
  )
  assert.equal(classifyPolicy('web_fetch', { url: 'https://x' }, settings), 'ask')
  assert.equal(classifyPolicy('file', { action: 'read' }, settings), 'ask')
})

test('given tools without an action, when classifying, then readTools allow and the rest ask', () => {
  const settings = policySettingsOf(configWith())
  assert.equal(classifyPolicy('sql', { stmt: 'SELECT 1' }, settings), 'allow')
  assert.equal(classifyPolicy('mystery', {}, settings), 'ask')
  assert.equal(classifyPolicy(undefined, {}, settings), undefined, '非本插件工具交给后续瀑布')
})

test('given approval configs, when reading the effective policy, then override and default resolve', () => {
  const ask: FakeApproval = { config: { policy: 'ask' }, overrideOf: () => undefined }
  const never: FakeApproval = { config: { policy: 'never' }, overrideOf: () => undefined }
  const overridden: FakeApproval = { config: { policy: 'ask' }, overrideOf: () => 'never' }
  const exec = { agent: { session: { id: 's1' } } }
  assert.equal(effectiveApprovalPolicy(fakeCtx(ask).ctx, exec), 'ask')
  assert.equal(effectiveApprovalPolicy(fakeCtx(never).ctx, exec), 'never')
  assert.equal(effectiveApprovalPolicy(fakeCtx(overridden).ctx, exec), 'never')
  assert.equal(effectiveApprovalPolicy(fakeCtx().ctx, exec), undefined, '无审批服务 = 无弹窗通道')
  assert.equal(
    effectiveApprovalPolicy(fakeCtx(ask).ctx, {}),
    undefined,
    '无 agent 会话时无法定位策略',
  )
})

test('given policy ask, when a write pre-executes, then it asks with localized display reasons', async () => {
  const { ctx, handlers } = fakeCtx({ config: { policy: 'ask' }, overrideOf: () => undefined })
  registerPolicy(ctx, policySettingsOf(configWith({ namePrefix: 'sy_' })), (publicName) =>
    publicName.startsWith('sy_') ? publicName.slice(3) : undefined,
  )
  const handler = handlers[0]
  assert.ok(handler !== undefined)

  const write = (await handler(
    { name: 'sy_document', arguments: { action: 'create' }, agent: { session: {} } },
    ALLOW_NEXT,
  )) as { kind: string; reason?: string; displayReason?: { en: string; zh: string } }
  assert.equal(write.kind, 'ask')
  assert.match(write.reason ?? '', /document action=create/)
  assert.match(write.displayReason?.en ?? '', /write operation/)
  assert.match(write.displayReason?.zh ?? '', /写操作/)

  const read = await handler(
    { name: 'sy_document', arguments: { action: 'get' }, agent: { session: {} } },
    ALLOW_NEXT,
  )
  assert.deepEqual(read, { kind: 'allow' })
})

test('given policy never (full-permission mode), when a write pre-executes, then it auto-passes', async () => {
  const { ctx, handlers } = fakeCtx({ config: { policy: 'never' }, overrideOf: () => undefined })
  registerPolicy(ctx, policySettingsOf(configWith()), () => 'document')
  const handler = handlers[0]
  assert.ok(handler !== undefined)
  const decision = await handler(
    { name: 'document', arguments: { action: 'move' }, agent: { session: {} } },
    ALLOW_NEXT,
  )
  assert.deepEqual(decision, { kind: 'allow' }, '完全权限模式下写操作全部自动通过')
})

test('given no approval service, when a write pre-executes, then it never silently denies', async () => {
  const { ctx, handlers } = fakeCtx(undefined)
  registerPolicy(ctx, policySettingsOf(configWith()), () => 'document')
  const handler = handlers[0]
  assert.ok(handler !== undefined)
  const decision = await handler(
    { name: 'document', arguments: { action: 'delete' }, agent: { session: {} } },
    ALLOW_NEXT,
  )
  assert.deepEqual(decision, { kind: 'allow' }, '无审批通道时放行，不让 ask 降级为拒绝')
})

test('given confirmWrites disabled, when pre-execute runs, then every call delegates unchanged', async () => {
  const { ctx, handlers } = fakeCtx({ config: { policy: 'ask' }, overrideOf: () => undefined })
  registerPolicy(ctx, policySettingsOf(configWith({ confirmWrites: false })), () => 'document')
  const handler = handlers[0]
  assert.ok(handler !== undefined)
  const decision = await handler(
    { name: 'document', arguments: { action: 'delete' }, agent: { session: {} } },
    ALLOW_NEXT,
  )
  assert.deepEqual(decision, { kind: 'allow' })
})

test('given non-owned tools, when pre-execute runs, then foreign calls delegate unchanged', async () => {
  const { ctx, handlers } = fakeCtx({ config: { policy: 'ask' }, overrideOf: () => undefined })
  const off = registerPolicy(ctx, policySettingsOf(configWith({ namePrefix: 'sy_' })), (name) =>
    name.startsWith('sy_') ? name.slice(3) : undefined,
  )
  const handler = handlers[0]
  assert.ok(handler !== undefined)
  const foreign = await handler(
    { name: 'bash', arguments: { command: 'ls' }, agent: { session: {} } },
    ALLOW_NEXT,
  )
  assert.deepEqual(foreign, { kind: 'allow' })
  off()
})

test('given the ask wording, when formatting, then reason and display text name the target', () => {
  const settings = policySettingsOf(configWith())
  assert.match(
    askReason('document', { action: 'create' }, settings),
    /document action=create：写操作/,
  )
  assert.match(askReason('sync', {}, settings), /外发\/包管理\/文件系统类操作/)
  const display = askDisplayReason('document', { action: 'move' }, settings)
  assert.match(display.en, /SiYuan document move: write operation/)
  assert.match(display.zh, /思源笔记 document move：写操作/)
})
