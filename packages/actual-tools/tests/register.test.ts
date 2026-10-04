import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ActualManifest, CapabilityEntry } from '@dsh-plus/actual'

import { type ActualToolsConfig, Config } from '../src/config.ts'
import {
  applyManifest,
  buildDefinition,
  emptyToolState,
  formatValue,
  publicNameOf,
  type RegisterDeps,
} from '../src/register.ts'

/** 最小执行上下文：本包 execute 只读取 exec.signal。 */
function runContext(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

function configWith(overrides: Partial<ActualToolsConfig> = {}): ActualToolsConfig {
  return { ...Config({}), ...overrides } as ActualToolsConfig
}

interface RegisteredDef {
  name: string
  description?: string
  parameters?: Record<string, unknown>
  timeoutMs?: number
  output?: { schema: unknown; render(args: unknown, value: unknown): unknown[] }
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
}

/** 工具注册替身：记录定义、模拟冲突、统计注销。 */
function fakeRegisterCtx(options?: { throwOn?: string }): {
  ctx: Context
  registered: RegisteredDef[]
  disposed: string[]
} {
  const registered: RegisteredDef[] = []
  const disposed: string[] = []
  const ctx = {
    tools: {
      register(def: RegisteredDef) {
        if (options?.throwOn === def.name) throw new Error('duplicate tool name')
        registered.push(def)
        return () => {
          disposed.push(def.name)
        }
      },
    },
    get: () => undefined,
  } as unknown as Context
  return { ctx, registered, disposed }
}

const DEGRADED_ENTRY: CapabilityEntry = {
  name: 'accounts',
  description: 'Manage accounts',
  source: 'cli',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['list'] } },
    required: ['action'],
    additionalProperties: false,
  },
  cli: { family: 'accounts', kind: 'subcommands', actionMap: { list: 'list' } },
}

const MCP_ENTRY: CapabilityEntry = {
  name: 'transactions',
  description: 'Manage transactions',
  source: 'mcp',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['list'] }, account: { type: 'string' } },
    required: ['action'],
    additionalProperties: false,
  },
  cli: { family: 'transactions', kind: 'subcommands', actionMap: { list: 'list' } },
}

function depsWith(ctx: Context, invokeCalls: unknown[][], config = configWith()): RegisterDeps {
  return {
    ctx,
    config,
    invoke: async (entry, args, options) => {
      invokeCalls.push([entry.name, args, options])
      return { ok: true }
    },
    logger: { error: () => {} },
  }
}

function manifestOf(entries: CapabilityEntry[], source: 'mcp' | 'cli' = 'mcp'): ActualManifest {
  return {
    source,
    cliVersion: '26.10.0',
    serverVersion: '26.10.0',
    entries,
    drift: { mcpOnly: [], cliOnly: [], unmapped: [] },
  }
}

test('given the degraded (cli) source, when building its definition, then the raw schema validates then invokes', async () => {
  const { ctx } = fakeRegisterCtx()
  const calls: unknown[][] = []
  const definition = buildDefinition(depsWith(ctx, calls), DEGRADED_ENTRY, 'actual_accounts')
  assert.equal(definition.name, 'actual_accounts')
  assert.deepEqual(definition.parameters, DEGRADED_ENTRY.inputSchema)
  assert.equal(definition.timeoutMs, 60_000)

  const rendered = definition.output?.render({}, { hello: 'world' })
  assert.deepEqual(rendered, [{ type: 'text', text: '{\n  "hello": "world"\n}' }])

  assert.deepEqual(await definition.execute({ action: 'list' }, runContext()), { ok: true })
  assert.equal(calls.length, 1)
  await assert.rejects(definition.execute({ action: 'nope' }, runContext()), /invalid arguments/)
})

test('given the mcp source, when building its definition, then the official adapter wraps name and schema', async () => {
  const { ctx } = fakeRegisterCtx()
  const calls: unknown[][] = []
  const definition = buildDefinition(depsWith(ctx, calls), MCP_ENTRY, 'actual_transactions')
  assert.equal(definition.name, 'actual_transactions')
  assert.deepEqual(definition.parameters, MCP_ENTRY.inputSchema)
  await definition.execute({ action: 'list', account: 'a1' }, runContext())
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.[0], 'transactions')
})

test('given namePrefix config, when computing public names, then prefix is applied consistently', () => {
  assert.equal(publicNameOf(configWith({ namePrefix: 'actual_' }), 'accounts'), 'actual_accounts')
  assert.equal(publicNameOf(configWith({ namePrefix: '' }), 'accounts'), 'accounts')
})

test('given a manifest, when applying it, then a full generation swaps atomically and owned names update', () => {
  const { ctx, registered, disposed } = fakeRegisterCtx()
  const state = emptyToolState()
  const deps = depsWith(ctx, [])
  applyManifest(deps, manifestOf([DEGRADED_ENTRY, MCP_ENTRY]), state)
  assert.equal(state.disposers.size, 2)
  assert.deepEqual([...state.owned.keys()].sort(), ['actual_accounts', 'actual_transactions'])
  assert.deepEqual(
    [...state.owned.values()].sort(),
    ['accounts', 'transactions'],
    '策略层按公开名反查裸能力名',
  )

  applyManifest(deps, manifestOf([DEGRADED_ENTRY, MCP_ENTRY]), state)
  assert.equal(registered.length, 2, '签名一致必须跳过换代')

  applyManifest(deps, manifestOf([MCP_ENTRY]), state)
  assert.deepEqual(disposed.sort(), ['actual_accounts', 'actual_transactions'], '旧代必须整体注销')
  assert.equal(state.disposers.size, 1)
})

test('given a source change with identical entries, when applying, then the generation is replaced', () => {
  const { ctx } = fakeRegisterCtx()
  const state = emptyToolState()
  const deps = depsWith(ctx, [])
  applyManifest(deps, manifestOf([MCP_ENTRY], 'mcp'), state)
  const first = state.signature
  applyManifest(deps, manifestOf([MCP_ENTRY], 'cli'), state)
  assert.notEqual(state.signature, first, '来源变化必须换代（注册机制不同）')
})

test('given one conflicting registration, when applying, then the rest stay registered and the failure logs', () => {
  const errors: string[] = []
  const { ctx, registered } = fakeRegisterCtx({ throwOn: 'actual_transactions' })
  const state = emptyToolState()
  applyManifest(
    { ...depsWith(ctx, []), logger: { error: (message) => errors.push(message) } },
    manifestOf([DEGRADED_ENTRY, MCP_ENTRY]),
    state,
  )
  assert.deepEqual(
    registered.map((def) => def.name),
    ['actual_accounts'],
  )
  assert.equal(state.disposers.size, 1)
  assert.match(errors[0] ?? '', /register actual_transactions failed/)
})

test('given a value, when rendering, then strings pass through and objects pretty-print', () => {
  assert.equal(formatValue('raw text'), 'raw text')
  assert.equal(formatValue([1, 2]), '[\n  1,\n  2\n]')
})
