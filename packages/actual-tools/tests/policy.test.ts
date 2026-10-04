import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { classifyAction, toSettings } from '@dsh-plus/actual'

import { type ActualToolsConfig, Config } from '../src/config.ts'
import {
  askReason,
  effectiveApprovalPolicy,
  policySettingsOf,
  registerPolicy,
} from '../src/policy.ts'

/** 以 schema 补默认，得到完整配置（等价加载器行为）。 */
function configWith(overrides: Partial<ActualToolsConfig> = {}): ActualToolsConfig {
  return { ...Config({}), ...overrides } as ActualToolsConfig
}

/** 默认判定集合。 */
function settings(overrides: Partial<ActualToolsConfig> = {}) {
  return policySettingsOf(configWith(overrides))
}

test('given an action on the read list, when classifying, then it runs directly', () => {
  const classify = settings().classify
  for (const action of [
    'list',
    'month',
    'months',
    'balance',
    'version',
    'get-id',
    'tables',
    'fields',
    'run',
    'common',
    'payee-rules',
  ]) {
    assert.equal(classifyAction('accounts', { action }, classify), 'allow', `${action} 应为读`)
  }
})

test('given a mutating action, when classifying, then it falls to the ask side', () => {
  const classify = settings().classify
  for (const [family, action] of [
    ['accounts', 'update'],
    ['accounts', 'delete'],
    ['transactions', 'add'],
    ['transactions', 'import'],
    ['budgets', 'set-amount'],
    ['budgets', 'download'],
    ['server', 'bank-sync'],
    ['rules', 'create'],
  ] as const) {
    assert.equal(classifyAction(family, { action }, classify), 'ask', `${action} 应为写`)
  }
})

test('given an unknown action, when classifying, then the safe side wins', () => {
  assert.equal(classifyAction('accounts', { action: 'brand-new-verb' }, settings().classify), 'ask')
})

test('given a tool without an action, when classifying, then only readTools lets it through', () => {
  assert.equal(classifyAction('sync', {}, settings().classify), 'ask')
  assert.equal(classifyAction('sync', {}, settings({ readTools: ['sync'] }).classify), 'allow')
})

test('given the CLI dry-run preview, when classifying, then it counts as a read', () => {
  const classify = settings().classify
  assert.equal(
    classifyAction('transactions', { action: 'import', dryRun: true }, classify),
    'allow',
  )
  assert.equal(classifyAction('transactions', { action: 'import', dryRun: false }, classify), 'ask')
  assert.equal(
    classifyAction('transactions', { action: 'add', dryRun: true }, classify),
    'ask',
    '只有官方声明「仅预览」的 import 才享受该豁免',
  )
})

test('given alwaysAsk, when classifying, then it overrides the read list', () => {
  const classify = settings({ alwaysAsk: ['query'] }).classify
  assert.equal(classifyAction('query', { action: 'run' }, classify), 'ask')
})

test('given the ask reason, when building it, then the action is named in Chinese', () => {
  assert.equal(
    askReason('accounts', { action: 'update' }, settings().classify),
    '确认 Actual accounts action=update：写操作，通过审批后执行。',
  )
  assert.equal(
    askReason('sync', {}, settings().classify),
    '确认 Actual sync：写操作，通过审批后执行。',
  )
})

type FakeExec = { name: string; arguments: unknown; agent?: { session: unknown } }

/** 组装只含审批接缝的 ctx 替身。 */
function fakeCtx(policy?: 'ask' | 'never'): { ctx: Context; seen: string[] } {
  const seen: string[] = []
  const ctx = {
    get(key: string) {
      if (key !== 'approval' || policy === undefined) return undefined
      return { config: { policy }, overrideOf: () => undefined }
    },
    on(event: string, _fn: unknown) {
      seen.push(event)
      return () => seen.push(`off:${event}`)
    },
  } as unknown as Context
  return { ctx, seen }
}

/** 触发一次 pre-execute。 */
async function preExecute(
  ctx: Context,
  rawNameOf: (name: string) => string | undefined,
  exec: FakeExec,
  config: Partial<ActualToolsConfig> = {},
): Promise<unknown> {
  let handler: ((exec: FakeExec, next: () => Promise<unknown>) => unknown) | undefined
  const capture = {
    ...ctx,
    on(_event: string, fn: (exec: FakeExec, next: () => Promise<unknown>) => unknown) {
      handler = fn
      return () => {}
    },
    get: ctx.get.bind(ctx),
  } as unknown as Context
  registerPolicy(capture, policySettingsOf(configWith(config)), rawNameOf)
  assert.ok(handler !== undefined)
  return await handler(exec, async () => ({ kind: 'allow' }))
}

test('given a write under policy=ask, when pre-executing, then the official approval bridge is asked', async () => {
  const { ctx } = fakeCtx('ask')
  const result = await preExecute(
    ctx,
    (name) => (name === 'actual_accounts' ? 'accounts' : undefined),
    { name: 'actual_accounts', arguments: { action: 'update' }, agent: { session: {} } },
  )
  assert.equal((result as { kind: string }).kind, 'ask')
  assert.match((result as { reason: string }).reason, /确认 Actual accounts action=update/)
  assert.deepEqual((result as { displayReason: unknown }).displayReason, {
    en: 'Actual accounts update: write operation — approve to run it once.',
    zh: 'Actual Budget accounts update：写操作，批准后执行一次。',
  })
})

test('given a read under policy=ask, when pre-executing, then it falls through to the waterfall', async () => {
  const { ctx } = fakeCtx('ask')
  const result = await preExecute(
    ctx,
    (name) => (name === 'actual_accounts' ? 'accounts' : undefined),
    { name: 'actual_accounts', arguments: { action: 'list' }, agent: { session: {} } },
  )
  assert.deepEqual(result, { kind: 'allow' })
})

test('given full permission, when pre-executing a write, then it passes without prompting', async () => {
  const { ctx } = fakeCtx('never')
  const result = await preExecute(
    ctx,
    (name) => (name === 'actual_accounts' ? 'accounts' : undefined),
    { name: 'actual_accounts', arguments: { action: 'delete' }, agent: { session: {} } },
  )
  assert.deepEqual(result, { kind: 'allow' }, 'approval=never 时写操作自动通过')
})

test('given no approval channel, when pre-executing a write, then it passes rather than silently denying', async () => {
  const { ctx } = fakeCtx(undefined)
  const result = await preExecute(
    ctx,
    (name) => (name === 'actual_accounts' ? 'accounts' : undefined),
    { name: 'actual_accounts', arguments: { action: 'delete' }, agent: { session: {} } },
  )
  assert.deepEqual(result, { kind: 'allow' })
})

test('given a foreign tool name, when pre-executing, then this plugin stays out of the way', async () => {
  const { ctx } = fakeCtx('ask')
  const result = await preExecute(ctx, () => undefined, {
    name: 'bash',
    arguments: { action: 'delete' },
    agent: { session: {} },
  })
  assert.deepEqual(result, { kind: 'allow' })
})

test('given confirmWrites disabled, when pre-executing a write, then everything falls through', async () => {
  const { ctx } = fakeCtx('ask')
  const result = await preExecute(
    ctx,
    (name) => (name === 'actual_accounts' ? 'accounts' : undefined),
    { name: 'actual_accounts', arguments: { action: 'delete' }, agent: { session: {} } },
    { confirmWrites: false },
  )
  assert.deepEqual(result, { kind: 'allow' })
})

test('given approval seam shapes, when reading the effective policy, then session override beats config', () => {
  const session = { id: 's1' }
  const withOverride = {
    get: () => ({ config: { policy: 'ask' }, overrideOf: () => 'never' }),
  } as unknown as Context
  assert.equal(
    effectiveApprovalPolicy(withOverride, { agent: { session } }),
    'never',
    '会话覆盖优先',
  )
  const configOnly = { get: () => ({ config: { policy: 'never' } }) } as unknown as Context
  assert.equal(effectiveApprovalPolicy(configOnly, { agent: { session } }), undefined)
  const noSession = {
    get: () => ({ config: { policy: 'ask' }, overrideOf: () => undefined }),
  } as unknown as Context
  assert.equal(effectiveApprovalPolicy(noSession, {}), undefined)
})

test('given an empty read list, when classifying, then everything is a write', () => {
  const classify = toSettings({ readActions: [], alwaysAsk: [], readTools: [] })
  assert.equal(classifyAction('accounts', { action: 'list' }, classify), 'ask')
})
