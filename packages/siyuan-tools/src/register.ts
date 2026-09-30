/**
 * 能力清单 → DSH 工具注册：MCP 条目经官方 `createMcpToolDefinition` 适配
 * （canonical 输出、镜像投影、错误语义全沿用官方实现），CLI 条目注册为
 * 裸 ToolDefinition（自校验入参、`-f json` 输出作 canonical 值）。
 * @module @dsh-plus/siyuan-tools/register
 */
import type { Context } from '@deepseek-ai/cordis'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import {
  type JsonSchemaNode,
  type ToolDefinition,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-tools'
import type { CapabilityEntry, SiyuanManifest } from '@dsh-plus/siyuan'

import type { SiyuanToolsConfig } from './config.ts'

/** 注册所需的依赖面（测试整体替身）。 */
export interface RegisterDeps {
  ctx: Context
  config: SiyuanToolsConfig
  invoke(
    entry: CapabilityEntry,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<unknown>
  logger: { error(message: string): void }
}

/** 一代注册的状态：公开名 → 注销器、公开名 → 裸能力名（策略用）。 */
export interface ToolState {
  signature: string
  disposers: Map<string, () => void>
  owned: Map<string, string>
}

/** 空状态工厂。 */
export function emptyToolState(): ToolState {
  return { signature: '', disposers: new Map(), owned: new Map() }
}

/** 模型可见工具名 = 前缀 + 裸能力名。 */
export function publicNameOf(config: SiyuanToolsConfig, rawName: string): string {
  return config.namePrefix + rawName
}

/** 由单条能力构造 ToolDefinition（MCP 走官方适配器，CLI 走裸定义）。 */
export function buildDefinition(deps: RegisterDeps, entry: CapabilityEntry): ToolDefinition {
  const name = publicNameOf(deps.config, entry.name)
  if (entry.source === 'mcp') {
    return createMcpToolDefinition(deps.ctx, {
      name,
      rawName: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema,
      ...(entry.outputSchema !== undefined ? { outputSchema: entry.outputSchema } : {}),
      ...(entry.taskRequired === true ? { taskRequired: true } : {}),
      call: (args, execution) =>
        deps.invoke(entry, args, {
          signal: execution.signal,
          timeoutMs: deps.config.toolCallTimeoutMs,
        }),
    })
  }
  return cliDefinition(deps, entry, name)
}

/** CLI 条目：裸 ToolDefinition，入参按原始 Schema 自校验。 */
function cliDefinition(deps: RegisterDeps, entry: CapabilityEntry, name: string): ToolDefinition {
  const timeoutMs = deps.config.toolCallTimeoutMs
  return {
    name,
    description: entry.description,
    parameters: entry.inputSchema,
    timeoutMs,
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: formatCliValue(value) }],
    },
    async execute(args, exec) {
      const violations = validateJsonSchemaValue(entry.inputSchema as JsonSchemaNode, args)
      if (violations.length > 0) throw new Error(`invalid arguments: ${violations.join('; ')}`)
      return await deps.invoke(entry, args as Record<string, unknown>, {
        signal: exec.signal,
        timeoutMs,
      })
    },
  }
}

/** CLI 输出渲染：字符串原样，其余 pretty JSON。 */
function formatCliValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

/**
 * 换代注册：签名一致则跳过；否则整代 dispose 后重建（同步完成，模型侧
 * 不会出现半代目录）。单条冲突仅丢弃该条并记 error。
 */
export function applyManifest(
  deps: RegisterDeps,
  manifest: SiyuanManifest,
  state: ToolState,
): void {
  const signature = JSON.stringify(manifest.entries)
  if (signature === state.signature) return
  for (const dispose of state.disposers.values()) dispose()
  state.disposers = new Map()
  state.owned = new Map()
  state.signature = signature
  for (const entry of manifest.entries) {
    const publicName = publicNameOf(deps.config, entry.name)
    try {
      state.disposers.set(publicName, deps.ctx.tools.register(buildDefinition(deps, entry)))
      state.owned.set(publicName, entry.name)
    } catch (error) {
      deps.logger.error(
        `register ${publicName} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
