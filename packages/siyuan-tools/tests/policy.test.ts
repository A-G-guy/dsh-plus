import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import { Config, type SiyuanToolsConfig } from '../src/config.ts'
import { askReason, classifyPolicy, policySettingsOf, registerPolicy } from '../src/policy.ts'

/** 以 schema 补默认得到子插件配置。 */
function configWith(overrides: Partial<SiyuanToolsConfig> = {}): SiyuanToolsConfig {
  return { ...Config({}), ...overrides } as SiyuanToolsConfig
}

/** pre-execute 监听捕获替身。 */
function fakeCtx(): {
  ctx: Context
  handlers: ((exec: unknown, next: () => Promise<unknown>) => unknown)[]
} {
  const handlers: ((exec: unknown, next: () => Promise<unknown>) => unknown)[] = []
  const ctx = {
    on(_event: string, fn: (exec: unknown, next: () => Promise<unknown>) => unknown) {
      handlers.push(fn)
      return () => {}
    },
  } as unknown as Context
  return { ctx, handlers }
}

test('given the default policy, when classifying actions, then reads allow and writes ask', () => {
  const settings = policySettingsOf(configWith())
  assert.equal(classifyPolicy('document', { action: 'get' }, settings), 'allow')
  assert.equal(classifyPolicy('block', { action: 'batch_get' }, settings), 'allow')
  assert.equal(classifyPolicy('document', { action: 'create' }, settings), 'ask')
  assert.equal(classifyPolicy('document', { action: 'delete' }, settings), 'ask')
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

test('given the ask reason, when formatting, then it names the target and the cause', () => {
  const settings = policySettingsOf(configWith())
  assert.match(
    askReason('document', { action: 'create' }, settings),
    /SiYuan document action=create：写操作/,
  )
  assert.match(askReason('sync', {}, settings), /外发\/包管理\/文件系统类操作/)
})

test('given a registered policy handler, when pre-execute runs, then owned writes ask and everything else delegates', async () => {
  const { ctx, handlers } = fakeCtx()
  const allowNext = async () => ({ kind: 'allow' as const })
  const off = registerPolicy(
    ctx,
    policySettingsOf(configWith({ namePrefix: 'sy_' })),
    (publicName) => (publicName.startsWith('sy_') ? publicName.slice(3) : undefined),
  )
  assert.equal(handlers.length, 1)
  const handler = handlers[0]
  assert.ok(handler !== undefined)

  const write = (await handler(
    { name: 'sy_document', arguments: { action: 'create' } },
    allowNext,
  )) as {
    kind: string
    reason?: string
  }
  assert.equal(write.kind, 'ask')
  assert.match(write.reason ?? '', /document action=create/)

  const read = await handler({ name: 'sy_document', arguments: { action: 'get' } }, allowNext)
  assert.deepEqual(read, { kind: 'allow' })

  const foreign = await handler({ name: 'bash', arguments: { command: 'ls' } }, allowNext)
  assert.deepEqual(foreign, { kind: 'allow' }, '非本插件工具不改变决策')
  off()
})

test('given confirmWrites disabled, when pre-execute runs, then every call delegates unchanged', async () => {
  const { ctx, handlers } = fakeCtx()
  registerPolicy(ctx, policySettingsOf(configWith({ confirmWrites: false })), () => 'document')
  const handler = handlers[0]
  assert.ok(handler !== undefined)
  const decision = await handler(
    { name: 'document', arguments: { action: 'delete' } },
    async () => ({
      kind: 'allow' as const,
    }),
  )
  assert.deepEqual(decision, { kind: 'allow' })
})
