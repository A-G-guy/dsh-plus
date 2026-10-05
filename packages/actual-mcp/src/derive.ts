/**
 * help 树 → 能力条目（纯函数，fixture 单测钉住）。
 *
 * 派生规则：
 * - 有子命令的家族 → 一个「族工具」+ `action` 枚举（枚举值连同逐动作短描述
 *   拼进 `action.description`，这是 schema 里唯一能承载逐动作语义的位置）；
 * - 无子命令的家族（如 `sync`）→ 一个直连工具，位置参数进 `required`；
 * - 选项按 action 求并集，取值选项与布尔开关分型；`choices` 收敛为 JSON Schema
 *   `enum`，逐 action 取值不一致时**丢弃 enum**（宁可放宽，也不误挡合法取值）；
 * - 子集出现的属性附 `[used by: …]` 注记——commander 不暴露必填性，
 *   「哪些动作用到它」是 help 能提供的最强线索；
 * - **同名选项与位置参数按属性名合并**（本 CLI 真有此例：`query run --table`
 *   与 `query fields <table>`），标签与动作集求并，既不丢信息也不产生误导注记。
 * @module @dsh-plus/actual-mcp/derive
 */

import { DEFAULT_READ_ACTIONS, DEFAULT_READ_TOOLS } from './classify.ts'
import type { CapabilityEntry } from './contract.ts'
import type { CliOption, CommanderHelp } from './help.ts'

/** 不可对外包装为工具的顶层命令（`help` 已由解析层剔除，此处为显式兜底）。 */
export const EXCLUDED_FAMILIES: ReadonlySet<string> = new Set(['help'])

/** 采集到的 help 树。 */
export interface HelpTree {
  root: CommanderHelp
  /** 家族名 → 家族级 help。 */
  families: Map<string, CommanderHelp>
  /** `${family} ${action}` → 动作级 help（采集失败时缺席）。 */
  actions: Map<string, CommanderHelp>
}

/** 派生选项。 */
export interface CatalogOptions {
  namePrefix?: string
  /** 只读动作集（用于整工具 `readOnly` 注解）。 */
  readActions?: readonly string[]
  /** 无 action 时按工具名判读的只读集。 */
  readTools?: readonly string[]
}

/** 派生结果：条目 + 诊断（不静默吞掉任何异常形态）。 */
export interface CatalogResult {
  entries: CapabilityEntry[]
  warnings: string[]
}

/** 属性并集累加器：并集期间攒片段与动作集，最后统一渲染 description 与注记。 */
interface PropAccumulator {
  base: Record<string, unknown>
  labels: string[]
  actions: string[]
  choices: string[][]
  value?: string
  fallback?: string
}

/** `order-by` → `orderBy`。 */
export function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}

/** 去掉 JSON 字面量的引号（`"0"` → `0`）。 */
function unquote(value: string): string {
  return /^"(.*)"$/.exec(value.trim())?.[1] ?? value.trim()
}

/** 取所有来源一致的枚举；不一致时返回 undefined（交由 CLI 校验）。 */
function agreedChoices(choices: string[][]): string[] | undefined {
  const first = choices[0]
  if (first === undefined) return undefined
  const same = choices.every(
    (candidate) =>
      candidate.length === first.length && candidate.every((value, i) => value === first[i]),
  )
  return same ? first : undefined
}

/** 取（或建）属性的累加器；已存在时保留先到的 JSON Schema 形状。 */
function accumulatorOf(acc: Map<string, PropAccumulator>, prop: string): PropAccumulator {
  const existing = acc.get(prop)
  if (existing !== undefined) return existing
  const created: PropAccumulator = { base: {}, labels: [], actions: [], choices: [] }
  acc.set(prop, created)
  return created
}

/** 并入一个选项。 */
function addOption(acc: Map<string, PropAccumulator>, action: string, option: CliOption): void {
  const slot = accumulatorOf(acc, kebabToCamel(option.name))
  slot.base = { type: option.value === undefined ? 'boolean' : 'string' }
  if (option.value !== undefined) slot.value = option.value
  if (option.description !== '' && !slot.labels.includes(option.description)) {
    slot.labels.push(option.description)
  }
  if (!slot.actions.includes(action)) slot.actions.push(action)
  if (option.choices !== undefined) slot.choices.push(option.choices)
  if (option.default !== undefined) slot.fallback = unquote(option.default)
}

/** 并入一个位置参数（与同名选项合并，不覆盖其形状）。 */
function addPositional(acc: Map<string, PropAccumulator>, action: string, name: string): string {
  const prop = kebabToCamel(name)
  const slot = accumulatorOf(acc, prop)
  if (Object.keys(slot.base).length === 0) slot.base = { type: 'string' }
  const label = `Positional argument <${name}>`
  if (!slot.labels.includes(label)) slot.labels.push(label)
  if (!slot.actions.includes(action)) slot.actions.push(action)
  return prop
}

/** 渲染属性表：描述片段合并 + 子集注记 + choices/default。 */
function renderProperties(
  acc: Map<string, PropAccumulator>,
  total: number,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [prop, slot] of acc) {
    const usedBy = slot.actions.length < total ? ` [used by: ${slot.actions.join(', ')}]` : ''
    const rendered: Record<string, unknown> = {
      ...slot.base,
      description: `${slot.labels.join(' | ')}${usedBy}`.trim(),
    }
    const choices = agreedChoices(slot.choices)
    if (choices !== undefined) rendered.enum = choices
    if (slot.fallback !== undefined && slot.value !== undefined) rendered.default = slot.fallback
    properties[prop] = rendered
  }
  return properties
}

/** 组装 `inputSchema`（`additionalProperties: false`，仅显式必填项进 required）。 */
function assembleSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  const inputSchema: Record<string, unknown> = {
    type: 'object',
    properties,
    additionalProperties: false,
  }
  if (required.length > 0) inputSchema.required = required
  return inputSchema
}

/** action 属性描述：枚举值 + 逐动作短描述（schema 里唯一能承载它的位置）。 */
function actionDescription(subcommands: { name: string; short: string }[]): string {
  const items = subcommands.map((sub) =>
    sub.short === '' ? sub.name : `${sub.name}: ${sub.short}`,
  )
  return `Operation. ${items.join('; ')}`
}

/** 工具描述 = 短描述 + Usage 行（不复述逐选项用法，那是 schema 的职责）。 */
function describe(family: string, help: CommanderHelp): string {
  const usage = help.usage !== '' ? help.usage : `actual ${family}`
  return help.short === '' ? `Usage: ${usage}` : `${help.short}\nUsage: ${usage}`
}

/** 有子命令的家族 → 族工具条目。 */
function buildSubcommandEntry(
  family: string,
  familyHelp: CommanderHelp,
  tree: HelpTree,
  options: CatalogOptions,
  warnings: string[],
): CapabilityEntry {
  const acc = new Map<string, PropAccumulator>()
  const positionalByProp: Record<string, string> = {}
  for (const sub of familyHelp.subcommands) {
    const actionHelp = tree.actions.get(`${family} ${sub.name}`)
    if (actionHelp === undefined) {
      warnings.push(`${family} ${sub.name}: 动作级 help 未采集，参数细节可能缺失`)
      for (const name of sub.positionals) {
        positionalByProp[addPositional(acc, sub.name, name)] = name
      }
      continue
    }
    for (const option of actionHelp.options) addOption(acc, sub.name, option)
    for (const name of actionHelp.positionals) {
      positionalByProp[addPositional(acc, sub.name, name)] = name
    }
  }
  const total = familyHelp.subcommands.length
  const properties: Record<string, unknown> = {
    action: {
      type: 'string',
      enum: familyHelp.subcommands.map((sub) => sub.name),
      description: actionDescription(familyHelp.subcommands),
    },
    ...renderProperties(acc, total),
  }
  const readActions = new Set(options.readActions ?? DEFAULT_READ_ACTIONS)
  const entry: CapabilityEntry = {
    name: family,
    description: describe(family, familyHelp),
    inputSchema: assembleSchema(properties, ['action']),
    source: 'cli',
    cli: {
      family,
      kind: 'subcommands',
      actionMap: Object.fromEntries(familyHelp.subcommands.map((sub) => [sub.name, sub.name])),
      positionalByProp,
    },
  }
  if (familyHelp.subcommands.every((sub) => readActions.has(sub.name))) entry.readOnly = true
  return entry
}

/** 无子命令的家族 → 直连工具条目。 */
function buildDirectEntry(
  family: string,
  familyHelp: CommanderHelp,
  options: CatalogOptions,
): CapabilityEntry {
  const acc = new Map<string, PropAccumulator>()
  for (const option of familyHelp.options) addOption(acc, family, option)
  const positionalByProp: Record<string, string> = {}
  for (const name of [...familyHelp.positionals, ...familyHelp.optionalPositionals]) {
    positionalByProp[addPositional(acc, family, name)] = name
  }
  const entry: CapabilityEntry = {
    name: family,
    description: describe(family, familyHelp),
    inputSchema: assembleSchema(renderProperties(acc, 1), familyHelp.positionals.map(kebabToCamel)),
    source: 'cli',
    cli: { family, kind: 'direct', positionalByProp },
  }
  if ((options.readTools ?? DEFAULT_READ_TOOLS).includes(family)) entry.readOnly = true
  return entry
}

/**
 * 由 help 树派生能力目录。
 * @param tree - 采集到的 help 树。
 * @param options - 命名与只读判定选项。
 * @returns 条目与诊断；家族顺序取 root 的 Commands 顺序（稳定）。
 */
export function buildCatalog(tree: HelpTree, options: CatalogOptions = {}): CatalogResult {
  const entries: CapabilityEntry[] = []
  const warnings: string[] = []
  for (const sub of tree.root.subcommands) {
    if (EXCLUDED_FAMILIES.has(sub.name)) continue
    const familyHelp = tree.families.get(sub.name)
    if (familyHelp === undefined) {
      warnings.push(`${sub.name}: 家族级 help 未采集，已跳过`)
      continue
    }
    const entry =
      familyHelp.subcommands.length > 0
        ? buildSubcommandEntry(sub.name, familyHelp, tree, options, warnings)
        : buildDirectEntry(sub.name, familyHelp, options)
    entry.name = `${options.namePrefix ?? ''}${sub.name}`
    entries.push(entry)
  }
  return { entries, warnings }
}

/**
 * MCP tools/list 与 CLI help 树的交叉校验。
 *
 * @param extraFamilies - 由伴侣 CLI 声明、本就不在官方 help 树里的族名（如 report）；
 *   它们既不算「CLI 独有」也不算漂移，避免把有意的扩展报成告警。
 */
export function computeDrift(
  mcpEntries: CapabilityEntry[],
  families: Map<string, CommanderHelp>,
  unmapped: string[],
  extraFamilies: readonly string[] = [],
): { mcpOnly: string[]; cliOnly: string[]; unmapped: string[] } {
  const mcpNames = new Set(mcpEntries.map((entry) => entry.name))
  const familyNames = new Set([...families.keys(), ...extraFamilies])
  return {
    mcpOnly: [...mcpNames].filter((name) => !familyNames.has(name)).sort(),
    cliOnly: [...familyNames].filter((name) => !mcpNames.has(name)).sort(),
    unmapped: [...unmapped].sort(),
  }
}
