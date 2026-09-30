/**
 * MCP 能力 ↔ kernel CLI 的纯映射层：CLI 原生工具派生、MCP→CLI 兜底计划、
 * argv 构造与交叉校验（全部纯函数，fixture 单测钉住）。
 * @module @dsh-plus/siyuan/cli-map
 */
import type { CapabilityDrift, CapabilityEntry, CliPlan } from './contract.ts'
import type { CliFlag, KernelHelp } from './help.ts'

/** 不可对外包装为工具的 cobra 顶层命令。 */
export const CLI_EXCLUDED_FAMILIES = new Set(['help', 'completion', 'serve'])

/** 同名匹配与 snake→kebab 化之后仍不一致的 MCP action → 子命令显式差异表。 */
export const ACTION_ALIASES: Record<string, Record<string, string>> = {
  document: { delete: 'remove', search_docs: 'search' },
}

/** Usage 位置参数名 → MCP 属性名的显式差异表。 */
export const POSITIONAL_ALIASES: Record<string, Record<string, string>> = {
  sql: { statement: 'stmt' },
}

/** `pageSize` → `page-size`。 */
export function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/** `page-size` → `pageSize`。 */
export function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** `set_icon` → `set-icon`。 */
export function snakeToKebab(value: string): string {
  return value.replace(/_/g, '-')
}

/** 解析 MCP action 在 cobra 家族中的子命令名；不可映射返回 undefined。 */
export function resolveCliAction(
  family: string,
  action: string,
  help: KernelHelp,
): string | undefined {
  const alias = ACTION_ALIASES[family]?.[action]
  const candidates = [alias, action, snakeToKebab(action)].filter(
    (c): c is string => c !== undefined,
  )
  return candidates.find((candidate) => help.subcommands.some((sub) => sub.name === candidate))
}

/** 把 MCP 属性映射到 Usage 位置参数；返回 `positionalByProp`，缺位返回 undefined。 */
function positionalMap(
  family: string,
  positionals: string[],
  properties: Record<string, unknown>,
): Record<string, string> | undefined {
  const map: Record<string, string> = {}
  for (const pos of positionals) {
    const alias = POSITIONAL_ALIASES[family]?.[pos]
    const prop =
      alias ??
      (pos in properties ? pos : kebabToCamel(pos) in properties ? kebabToCamel(pos) : undefined)
    if (prop === undefined) return undefined
    map[prop] = pos
  }
  return map
}

/**
 * 为一条 MCP 能力构造 CLI 兜底执行计划。
 * @returns 计划；action/位置参数无法全部映射时为 undefined（该能力无兜底）。
 */
export function buildCliPlan(
  entry: Pick<CapabilityEntry, 'name' | 'inputSchema'>,
  familyHelp: KernelHelp,
): CliPlan | undefined {
  const family = entry.name
  const properties = (entry.inputSchema.properties ?? {}) as Record<string, unknown>
  const actionEnum = actionEnumOf(entry.inputSchema)
  const positionals = positionalMap(family, familyHelp.positionals, properties)

  if (familyHelp.subcommands.length > 0) {
    const actionMap: Record<string, string> = {}
    for (const action of actionEnum ?? []) {
      const resolved = resolveCliAction(family, action, familyHelp)
      if (resolved === undefined) return undefined
      actionMap[action] = resolved
    }
    const plan: CliPlan = { family, kind: 'subcommands', actionMap }
    if (positionals !== undefined) plan.positionalByProp = positionals
    return plan
  }

  if ((actionEnum ?? []).length > 1) return undefined
  const plan: CliPlan = { family, kind: 'direct' }
  if (positionals !== undefined) plan.positionalByProp = positionals
  return plan
}

/** 读取 `properties.action.enum`（缺失按 undefined 处理）。 */
export function actionEnumOf(inputSchema: Record<string, unknown>): string[] | undefined {
  const properties = inputSchema.properties as Record<string, unknown> | undefined
  const action = properties?.action as { enum?: unknown } | undefined
  return Array.isArray(action?.enum)
    ? action.enum.filter((v): v is string => typeof v === 'string')
    : undefined
}

/**
 * 由 `kernel <family> --help`（可选叠加 action 级 help）派生 CLI 原生工具。
 *
 * 子命令家族的 flag 按 action 求并集，逐 action 的必选性以
 * `[required for: …]` 注记进描述（Schema 无法表达按 action 分歧的必选），
 * 真正的强制交给 cobra 与 `buildArgv` 的缺失检查。
 * @param family - 顶层命令名。
 * @param help - 家族级 help。
 * @param actionHelps - `${family} ${action}` → 子命令 help（降级发现采集）。
 */
export function buildCliEntry(
  family: string,
  help: KernelHelp,
  actionHelps: Map<string, KernelHelp> = new Map(),
): CapabilityEntry {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  if (help.subcommands.length > 0) {
    properties.action = {
      type: 'string',
      enum: help.subcommands.map((s) => s.name),
      description: 'Operation',
    }
    required.push('action')
    collectUnionFlags(family, help, actionHelps, properties)
  } else {
    for (const flag of help.flags) {
      const prop = kebabToCamel(flag.name)
      properties[prop] = flagTypeToSchema(flag.type, flag.description)
      if (flag.required) required.push(prop)
    }
    for (const pos of help.positionals) {
      properties[kebabToCamel(pos)] = {
        type: 'string',
        description: `Positional argument <${pos}>`,
      }
      required.push(kebabToCamel(pos))
    }
  }
  const inputSchema: Record<string, unknown> = {
    type: 'object',
    properties,
    additionalProperties: false,
  }
  if (required.length > 0) inputSchema.required = required

  const plan: CliPlan =
    help.subcommands.length > 0
      ? {
          family,
          kind: 'subcommands',
          actionMap: Object.fromEntries(help.subcommands.map((s) => [s.name, s.name])),
        }
      : {
          family,
          kind: 'direct',
          positionalByProp: Object.fromEntries(help.positionals.map((p) => [kebabToCamel(p), p])),
        }
  const description = help.usage !== '' ? `${help.short}\nUsage: ${help.usage}` : help.short
  return { name: family, description, inputSchema, source: 'cli', cli: plan }
}

/** 汇总各 action 的 flag/位置参数并集写入 properties（含必选性注记）。 */
function collectUnionFlags(
  family: string,
  help: KernelHelp,
  actionHelps: Map<string, KernelHelp>,
  properties: Record<string, unknown>,
): void {
  const flags = new Map<
    string,
    { type: CliFlag['type']; description: string; requiredBy: string[] }
  >()
  const positionals = new Map<string, string[]>()
  for (const sub of help.subcommands) {
    const subHelp = actionHelps.get(`${family} ${sub.name}`)
    if (subHelp === undefined) continue
    for (const flag of subHelp.flags) {
      const slot = flags.get(flag.name) ?? {
        type: flag.type,
        description: flag.description,
        requiredBy: [],
      }
      if (flag.required && !slot.requiredBy.includes(sub.name)) slot.requiredBy.push(sub.name)
      flags.set(flag.name, slot)
    }
    for (const pos of subHelp.positionals) {
      const owners = positionals.get(pos) ?? []
      if (!owners.includes(sub.name)) owners.push(sub.name)
      positionals.set(pos, owners)
    }
  }
  if (flags.size === 0) {
    for (const flag of help.flags)
      flags.set(flag.name, { type: flag.type, description: flag.description, requiredBy: [] })
  }
  for (const [name, slot] of flags) {
    const suffix =
      slot.requiredBy.length > 0 ? ` [required for: ${slot.requiredBy.join(', ')}]` : ''
    properties[kebabToCamel(name)] = flagTypeToSchema(slot.type, `${slot.description}${suffix}`)
  }
  for (const [pos, owners] of positionals) {
    properties[kebabToCamel(pos)] = {
      type: 'string',
      description: `Positional argument <${pos}> (used by: ${owners.join(', ')})`,
    }
  }
}

/** cobra flag 类型 → JSON Schema 片段。 */
function flagTypeToSchema(
  type: 'string' | 'stringArray' | 'int' | 'bool',
  description: string,
): Record<string, unknown> {
  if (type === 'stringArray') return { type: 'array', items: { type: 'string' }, description }
  if (type === 'int') return { type: 'integer', description }
  if (type === 'bool') return { type: 'boolean', description }
  return { type: 'string', description }
}

/** 健康清单与 CLI help 树的交叉校验。 */
export function computeDrift(
  mcpEntries: CapabilityEntry[],
  helps: Map<string, KernelHelp>,
  unmapped: string[],
): CapabilityDrift {
  const mcpNames = new Set(mcpEntries.map((entry) => entry.name))
  const mcpOnly = [...mcpNames].filter((name) => !helps.has(name)).sort()
  const cliOnly = [...helps.keys()].filter((name) => !mcpNames.has(name)).sort()
  return { mcpOnly, cliOnly, unmapped: [...unmapped].sort() }
}

/** `buildArgv` 的产物：待执行参数、缺失必选项与被忽略的多余属性。 */
export interface ArgvPlan {
  argv: string[]
  missingRequired: string[]
  ignored: string[]
}

/**
 * 由模型参数与调用级 help 构造 `kernel …` argv（不含 `-f json -w` 全局项）。
 * @param args - 模型入参（已冻结的 JSON 对象）。
 * @param plan - 兜底执行计划。
 * @param invHelp - 调用级 help（子命令 help 或 direct 家族 help）。
 */
export function buildArgv(
  args: Record<string, unknown>,
  plan: CliPlan,
  invHelp: KernelHelp,
): ArgvPlan {
  const argv: string[] = []
  const missingRequired: string[] = []
  const consumed = new Set<string>(['action'])

  if (plan.kind === 'subcommands') {
    const action = typeof args.action === 'string' ? args.action : undefined
    const mapped = action === undefined ? undefined : plan.actionMap?.[action]
    if (mapped === undefined) missingRequired.push('action')
    else argv.push(mapped)
  }

  const posToProp = new Map<string, string>(
    Object.entries(plan.positionalByProp ?? {}).map(([prop, pos]) => [pos, prop]),
  )
  for (const pos of invHelp.positionals) {
    const prop = posToProp.get(pos) ?? (kebabToCamel(pos) in args ? kebabToCamel(pos) : pos)
    consumed.add(prop)
    const value = args[prop]
    if (value === undefined || value === null) {
      missingRequired.push(prop)
      continue
    }
    argv.push(String(value))
  }

  for (const flag of invHelp.flags) {
    const prop = kebabToCamel(flag.name)
    consumed.add(prop)
    const value = args[prop]
    if (value === undefined || value === null || value === false) {
      if (flag.required) missingRequired.push(prop)
      continue
    }
    if (flag.type === 'bool') {
      argv.push(`--${flag.name}`)
      continue
    }
    const rendered = renderFlagValue(flag.type, value)
    if (rendered === undefined) {
      missingRequired.push(prop)
      continue
    }
    for (const token of rendered) argv.push(`--${flag.name}`, token)
  }

  const ignored = Object.keys(args).filter((key) => !consumed.has(key))
  return { argv, missingRequired, ignored }
}

/** 参数值 → CLI token 序列；类型不符返回 undefined（按缺失处理）。bool 走调用方特判。 */
function renderFlagValue(
  type: 'string' | 'stringArray' | 'int',
  value: unknown,
): string[] | undefined {
  if (type === 'stringArray') {
    const list = Array.isArray(value) ? value : [value]
    return list.map((v) => String(v))
  }
  if (type === 'int') {
    const num = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(num) ? [String(Math.trunc(num))] : undefined
  }
  return [typeof value === 'string' ? value : JSON.stringify(value)]
}
