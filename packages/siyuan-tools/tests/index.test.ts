import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { CapabilityEntry, SiyuanManifest, SiyuanStatus } from '@dsh-plus/siyuan'

import { apply, Config, type SiyuanToolsConfig } from '../src/index.ts'

interface RegisteredDef {
  name: string
  description: string
}

/** pre-execute 替身的执行视图（审批策略需要 agent.session）。 */
type FakeExec = { name: string; arguments: unknown; agent?: { session: unknown } }

/** 服务/注册表/事件的整体替身，覆盖 apply 用到的全部 cordis 面。 */
function fakeCtx(options?: {
  discover?: () => Promise<SiyuanManifest>
  approvalPolicy?: 'ask' | 'never'
}): {
  ctx: Context
  registered: RegisteredDef[]
  disposed: () => number
  handlers: Map<string, (exec: FakeExec, next: () => Promise<unknown>) => unknown>
  changeCb: (() => void) | undefined
  cleanups: (() => void)[]
  logs: string[]
  discoverCount: () => number
} {
  const registered: RegisteredDef[] = []
  const disposers: (() => void)[] = []
  const handlers = new Map<string, (exec: FakeExec, next: () => Promise<unknown>) => unknown>()
  let changeCb: (() => void) | undefined
  let discovers = 0
  const logs: string[] = []
  const cleanups: (() => void)[] = []
  const status: SiyuanStatus = {
    mode: 'docker',
    endpoint: 'http://127.0.0.1:6806',
    version: '3.8.6',
    mcpConnected: true,
    cliAvailable: true,
  }
  const siyuan = {
    async discover(): Promise<SiyuanManifest> {
      discovers += 1
      if (options?.discover !== undefined) return await options.discover()
      return {
        source: 'mixed',
        version: '3.8.6',
        entries: [entry('document')],
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
  const ctx = {
    siyuan,
    logger: () => ({
      info: (m: string) => logs.push(`info:${m}`),
      warn: (m: string) => logs.push(`warn:${m}`),
      error: (m: string) => logs.push(`error:${m}`),
    }),
    tools: {
      register(def: RegisteredDef) {
        registered.push(def)
        return () => disposers.push(() => {})
      },
    },
    on(event: string, fn: (exec: FakeExec, next: () => Promise<unknown>) => unknown) {
      handlers.set(event, fn)
      return () => handlers.delete(event)
    },
    get(key: string) {
      if (key !== 'approval') return undefined
      const policy = options?.approvalPolicy ?? 'ask'
      return { config: { policy }, overrideOf: () => undefined }
    },
    effect(fn: () => (() => void) | void) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  } as unknown as Context
  return {
    ctx,
    registered,
    disposed: () => disposers.length,
    handlers,
    get changeCb() {
      return changeCb
    },
    cleanups,
    logs,
    discoverCount: () => discovers,
  } as never
}

function entry(name: string): CapabilityEntry {
  return {
    name,
    description: `${name} operations`,
    source: 'mcp',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    cli: { family: name, kind: 'subcommands', actionMap: {} },
  }
}

function configWith(overrides: Partial<SiyuanToolsConfig> = {}): SiyuanToolsConfig {
  return { ...Config({}), ...overrides } as SiyuanToolsConfig
}

test('given a discoverable manifest, when apply runs, then tools register, policy binds and cleanup disposes', async () => {
  const fake = fakeCtx()
  await apply(fake.ctx, configWith())
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['document'],
  )

  const handler = fake.handlers.get('tools/pre-execute')
  assert.ok(handler !== undefined, '写确认监听必须注册')
  const write = await handler(
    { name: 'document', arguments: { action: 'delete' }, agent: { session: {} } },
    async () => ({
      kind: 'allow',
    }),
  )
  assert.equal((write as { kind: string }).kind, 'ask', 'policy=ask 时写操作弹审批')
  const read = await handler(
    { name: 'document', arguments: { action: 'get' }, agent: { session: {} } },
    async () => ({
      kind: 'allow',
    }),
  )
  assert.deepEqual(read, { kind: 'allow' })

  const cleanup = fake.cleanups.at(-1)
  assert.ok(cleanup !== undefined)
  cleanup()
  assert.equal(fake.disposed(), 1, 'fiber 卸载必须注销工具')
})

test('given namePrefix, when apply runs, then public names carry the prefix and policy strips it', async () => {
  const fake = fakeCtx()
  await apply(fake.ctx, configWith({ namePrefix: 'sy_' }))
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['sy_document'],
  )
  const handler = fake.handlers.get('tools/pre-execute')
  assert.ok(handler !== undefined)
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
    { name: 'document', arguments: { action: 'move' }, agent: { session: {} } },
    async () => ({ kind: 'allow' }),
  )
  assert.deepEqual(write, { kind: 'allow' }, '完全权限模式（approval=never）写操作自动通过')
})

test('given a failing discovery, when apply runs, then activation still settles with a warn and a retry', async () => {
  const fake = fakeCtx({
    discover: () => Promise.reject(new Error('SiYuan 不可达：connect timeout')),
  })
  await apply(fake.ctx, configWith())
  assert.equal(fake.registered.length, 0)
  assert.ok(
    fake.logs.some((line) => line.startsWith('warn:') && line.includes('connect timeout')),
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
      version: `v${version}`,
      entries: [entry(version === 1 ? 'document' : 'sql')],
      drift: { mcpOnly: [], cliOnly: [], unmapped: [] },
    }),
  })
  await apply(fake.ctx, configWith())
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['document'],
  )

  version = 2
  fake.changeCb?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    fake.registered.map((def) => def.name),
    ['document', 'sql'],
    '换代注册追加新工具',
  )
  assert.equal(fake.discoverCount(), 2)
})
