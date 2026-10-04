import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ActualManifest, ActualStatus, CapabilityEntry } from '@dsh-plus/actual'

import { type ActualToolsConfig, apply, Config } from '../src/index.ts'

interface RegisteredDef {
  name: string
  description: string
}

type FakeExec = { name: string; arguments: unknown; agent?: { session: unknown } }

/** pre-execute 处理器签名。 */
type Handler = (exec: FakeExec, next: () => Promise<unknown>) => unknown

/** apply 用到的全部 cordis 面的整体替身。 */
function fakeCtx(options?: {
  discover?: () => Promise<ActualManifest>
  approvalPolicy?: 'ask' | 'never'
  systemPrompt?: boolean
}) {
  const registered: RegisteredDef[] = []
  const disposers: (() => void)[] = []
  const handlers = new Map<string, Handler>()
  const cleanups: (() => void)[] = []
  const logs: string[] = []
  let changeCb: (() => void) | undefined
  let discovers = 0
  const status: ActualStatus = {
    cli: 'PATH 上的 actual',
    cliVersion: '26.10.0',
    cliAvailable: true,
    serverUrl: 'http://127.0.0.1:5006',
    serverVersion: '26.10.0',
    mcpConnected: true,
    versionStatus: 'ok',
  }
  const actual = {
    async discover(): Promise<ActualManifest> {
      discovers += 1
      if (options?.discover !== undefined) return await options.discover()
      return {
        source: 'mixed',
        cliVersion: '26.10.0',
        serverVersion: '26.10.0',
        entries: [entry('accounts')],
        drift: { mcpOnly: [], cliOnly: [], unmapped: [] },
      }
    },
    invoke: async () => ({ ok: true }),
    onChange(cb: () => void) {
      changeCb = cb
      return () => {
        changeCb = undefined
      }
    },
    status: () => status,
  }
  const prompt = {
    context() {
      return () => {}
    },
  }
  const ctx = {
    actual,
    logger: () => ({
      info: (message: string) => logs.push(`info:${message}`),
      warn: (message: string) => logs.push(`warn:${message}`),
      error: (message: string) => logs.push(`error:${message}`),
    }),
    tools: {
      register(def: RegisteredDef) {
        registered.push(def)
        return () => disposers.push(() => {})
      },
    },
    on(event: string, fn: Handler) {
      handlers.set(event, fn)
      return () => handlers.delete(event)
    },
    get(key: string) {
      if (key === 'systemPrompt') return options?.systemPrompt === true ? prompt : undefined
      if (key !== 'approval') return undefined
      const policy = options?.approvalPolicy ?? 'ask'
      return { config: { policy }, overrideOf: () => undefined }
    },
    effect(fn: () => (() => void) | undefined) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  } as unknown as Context
  return {
    ctx,
    registered,
    handlers,
    cleanups,
    logs,
    disposed: () => disposers.length,
    changeCb: () => changeCb,
    discoverCount: () => discovers,
  }
}

function entry(name: string, source: 'mcp' | 'cli' = 'mcp'): CapabilityEntry {
  return {
    name,
    description: `${name} operations`,
    source,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    cli: { family: name, kind: 'subcommands', actionMap: {} },
  }
}

function configWith(overrides: Partial<ActualToolsConfig> = {}): ActualToolsConfig {
  return { ...Config({}), ...overrides } as ActualToolsConfig
}

test('given a discoverable manifest, when apply runs, then tools register, policy binds and cleanup disposes', async () => {
  const fake = fakeCtx()
  await apply(fake.ctx, configWith())
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['actual_accounts'],
  )

  const handler = fake.handlers.get('tools/pre-execute')
  assert.ok(handler !== undefined, '写确认监听必须注册')
  const write = await handler(
    { name: 'actual_accounts', arguments: { action: 'delete' }, agent: { session: {} } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal((write as { kind: string }).kind, 'ask', 'policy=ask 时写操作弹审批')
  const read = await handler(
    { name: 'actual_accounts', arguments: { action: 'list' }, agent: { session: {} } },
    async () => ({ kind: 'allow' }),
  )
  assert.deepEqual(read, { kind: 'allow' })

  const cleanup = fake.cleanups.at(-1)
  assert.ok(cleanup !== undefined)
  cleanup()
  assert.equal(fake.disposed(), 1, 'fiber 卸载必须注销工具')
})

test('given namePrefix, when apply runs, then public names carry the prefix and policy strips it', async () => {
  const fake = fakeCtx()
  await apply(fake.ctx, configWith({ namePrefix: 'ab_' }))
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['ab_accounts'],
  )
  const handler = fake.handlers.get('tools/pre-execute')
  assert.ok(handler !== undefined)
  assert.equal(
    (
      (await handler(
        { name: 'ab_accounts', arguments: { action: 'delete' }, agent: { session: {} } },
        async () => ({ kind: 'allow' }),
      )) as { kind: string }
    ).kind,
    'ask',
    '前缀必须被策略层正确剥离',
  )
  const foreign = await handler(
    { name: 'bash', arguments: {}, agent: { session: {} } },
    async () => ({ kind: 'allow' }),
  )
  assert.deepEqual(foreign, { kind: 'allow' })
})

test('given full-permission approval policy, when a write pre-executes, then it passes without prompting', async () => {
  const fake = fakeCtx({ approvalPolicy: 'never' })
  await apply(fake.ctx, configWith())
  const handler = fake.handlers.get('tools/pre-execute')
  assert.ok(handler !== undefined)
  const write = await handler(
    { name: 'actual_accounts', arguments: { action: 'delete' }, agent: { session: {} } },
    async () => ({ kind: 'allow' }),
  )
  assert.deepEqual(write, { kind: 'allow' }, '完全权限模式（approval=never）写操作自动通过')
})

test('given a degraded manifest, when apply runs, then tools still register from CLI entries', async () => {
  const fake = fakeCtx({
    discover: async () => ({
      source: 'cli',
      cliVersion: '26.10.0',
      serverVersion: '',
      entries: [entry('accounts', 'cli')],
      drift: { mcpOnly: [], cliOnly: [], unmapped: [] },
    }),
  })
  await apply(fake.ctx, configWith())
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['actual_accounts'],
  )
  assert.ok(fake.logs.some((line) => line.includes('source=cli')))
})

test('given a failing discovery, when apply runs, then activation still settles with a warn and a retry', async () => {
  const fake = fakeCtx({
    discover: () => Promise.reject(new Error('Actual CLI 不可用：ENOENT')),
  })
  await apply(fake.ctx, configWith())
  assert.equal(fake.registered.length, 0)
  assert.ok(
    fake.logs.some((line) => line.startsWith('warn:') && line.includes('ENOENT')),
    '失败必须记录并带上下文',
  )
  const cleanup = fake.cleanups.at(-1)
  assert.ok(cleanup !== undefined)
  cleanup()
  assert.equal(fake.disposed(), 0)
})

test('given a manifest change event, when the subscription fires, then the catalog re-syncs', async () => {
  let version = 1
  const fake = fakeCtx({
    discover: async () => ({
      source: 'mixed',
      cliVersion: `v${version}`,
      serverVersion: '26.10.0',
      entries: [entry(version === 1 ? 'accounts' : 'query')],
      drift: { mcpOnly: [], cliOnly: [], unmapped: [] },
    }),
  })
  await apply(fake.ctx, configWith())
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['actual_accounts'],
  )

  version = 2
  fake.changeCb()?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['actual_accounts', 'actual_query'],
    '换代注册追加新工具',
  )
  assert.equal(fake.discoverCount(), 2)
})

test('given the systemPrompt service, when apply runs, then the env snapshot is contributed and released', async () => {
  const fake = fakeCtx({ systemPrompt: true })
  await apply(fake.ctx, configWith())
  const cleanup = fake.cleanups.at(-1)
  assert.ok(cleanup !== undefined)
  cleanup()
  assert.equal(fake.disposed(), 1)
})

test('given the exported service shape, when inspecting, then inject covers both required services', async () => {
  const module = await import('../src/index.ts')
  assert.deepEqual([...module.inject], ['actual', 'tools'])
  assert.equal(module.name, 'dsh-plus-actual-tools')
})
