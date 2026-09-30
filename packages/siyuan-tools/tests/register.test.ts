import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { CapabilityEntry, SiyuanManifest } from '@dsh-plus/siyuan'

import { Config, type SiyuanToolsConfig } from '../src/config.ts'
import {
  applyManifest,
  buildDefinition,
  emptyToolState,
  publicNameOf,
  type RegisterDeps,
} from '../src/register.ts'

/** 最小执行上下文：本包 execute 只读取 exec.signal。 */
function runContext(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

function configWith(overrides: Partial<SiyuanToolsConfig> = {}): SiyuanToolsConfig {
  return { ...Config({}), ...overrides } as SiyuanToolsConfig
}

interface RegisteredDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  timeoutMs?: number
  output: { schema: unknown; render(args: unknown, value: unknown): unknown[] }
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

const CLI_ENTRY: CapabilityEntry = {
  name: 'document',
  description: 'Manage documents',
  source: 'cli',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['get'] } },
    required: ['action'],
    additionalProperties: false,
  },
  cli: { family: 'document', kind: 'subcommands', actionMap: { get: 'get' } },
}

const MCP_ENTRY: CapabilityEntry = {
  name: 'sql',
  description: 'Read-only SQL',
  source: 'mcp',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['query'] }, stmt: { type: 'string' } },
    required: ['action', 'stmt'],
    additionalProperties: false,
  },
}

function depsWith(ctx: Context, invokeCalls: unknown[][]): RegisterDeps {
  return {
    ctx,
    config: configWith(),
    invoke: async (entry, args, options) => {
      invokeCalls.push([entry.name, args, options])
      return { ok: true }
    },
    logger: { error: () => {} },
  }
}

function manifestOf(entries: CapabilityEntry[]): SiyuanManifest {
  return {
    source: 'mixed',
    version: '3.8.6',
    entries,
    drift: { mcpOnly: [], cliOnly: [], unmapped: [] },
  }
}

test('given a CLI entry, when building its definition, then raw schema is used and execution validates then invokes', async () => {
  const { ctx } = fakeRegisterCtx()
  const calls: unknown[][] = []
  const definition = buildDefinition(depsWith(ctx, calls), CLI_ENTRY)
  assert.equal(definition.name, 'document')
  assert.deepEqual(definition.parameters, CLI_ENTRY.inputSchema)
  assert.equal(definition.timeoutMs, 60_000)

  const rendered = definition.output.render({}, { hello: 'world' })
  assert.deepEqual(rendered, [{ type: 'text', text: '{\n  "hello": "world"\n}' }])

  const value = await definition.execute({ action: 'get' }, runContext())
  assert.deepEqual(value, { ok: true })
  assert.equal(calls.length, 1)

  await assert.rejects(definition.execute({ action: 'nope' }, runContext()), /invalid arguments/)
})

test('given an MCP entry, when building its definition, then the official adapter wraps name, schema and call', async () => {
  const { ctx } = fakeRegisterCtx()
  const calls: unknown[][] = []
  const definition = buildDefinition(depsWith(ctx, calls), MCP_ENTRY)
  assert.equal(definition.name, 'sql')
  assert.deepEqual(definition.parameters, MCP_ENTRY.inputSchema)
  await definition.execute({ action: 'query', stmt: 'SELECT 1' }, runContext())
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.[0], 'sql')
})

test('given namePrefix config, when computing public names, then prefix is applied consistently', () => {
  assert.equal(publicNameOf(configWith({ namePrefix: 'sy_' }), 'document'), 'sy_document')
  assert.equal(publicNameOf(configWith(), 'document'), 'document')
})

test('given a manifest, when applying it, then a full generation swaps atomically and owned names update', () => {
  const { ctx, registered, disposed } = fakeRegisterCtx()
  const state = emptyToolState()
  const deps = depsWith(ctx, [])
  applyManifest(deps, manifestOf([CLI_ENTRY, MCP_ENTRY]), state)
  assert.equal(state.disposers.size, 2)
  assert.deepEqual([...state.owned.keys()].sort(), ['document', 'sql'])

  applyManifest(deps, manifestOf([CLI_ENTRY, MCP_ENTRY]), state)
  assert.equal(registered.length, 2, '签名一致必须跳过换代')

  applyManifest(deps, manifestOf([MCP_ENTRY]), state)
  assert.deepEqual(disposed.sort(), ['document', 'sql'], '旧代必须整体注销')
  assert.equal(state.disposers.size, 1)
  assert.deepEqual([...state.owned.keys()], ['sql'])
})

test('given one conflicting registration, when applying, then the rest stay registered and the failure logs', () => {
  const errors: string[] = []
  const { ctx, registered } = fakeRegisterCtx({ throwOn: 'sql' })
  const state = emptyToolState()
  const deps: RegisterDeps = {
    ...depsWith(ctx, []),
    logger: { error: (message) => errors.push(message) },
  }
  applyManifest(deps, manifestOf([CLI_ENTRY, MCP_ENTRY]), state)
  assert.deepEqual(
    registered.map((def) => def.name),
    ['document'],
  )
  assert.equal(state.disposers.size, 1)
  assert.match(errors[0] ?? '', /register sql failed/)
})

test('given a beforeWrite hook, when executing, then it runs before invoke and its failure blocks the write', async () => {
  const { ctx } = fakeRegisterCtx()
  const calls: unknown[][] = []
  let hooks = 0

  // 钩子抛错（快照失败）→ 写入被中止，invoke 不发生
  const blocking: RegisterDeps = {
    ...depsWith(ctx, calls),
    beforeWrite: async () => {
      hooks += 1
      throw new Error('snapshot boom')
    },
  }
  const cliDef = buildDefinition(blocking, CLI_ENTRY)
  await assert.rejects(cliDef.execute({ action: 'get' }, runContext()), /snapshot boom/)
  assert.equal(calls.length, 0, '钩子失败时不得执行写入')
  assert.equal(hooks, 1)

  // 钩子通过 → MCP 分支同样先挂钩再执行
  const passing: RegisterDeps = {
    ...depsWith(ctx, calls),
    beforeWrite: async () => {
      hooks += 1
    },
  }
  const mcpDef = buildDefinition(passing, MCP_ENTRY)
  await mcpDef.execute({ action: 'query', stmt: 'SELECT 1' }, runContext())
  assert.equal(calls.length, 1)
  assert.equal(hooks, 2)
})
