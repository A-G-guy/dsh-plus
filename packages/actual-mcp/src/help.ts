/**
 * commander `actual … --help` 文本解析（纯函数，fixture 单测钉住）。
 *
 * 只解析派生工具所需的事实：Usage 行（位置参数）、首段短描述、Options 段
 * （取值占位符/choices/default/stdin 声明）与 Commands 段（子命令及其位置参数）。
 *
 * 两个必须处理的 commander 形态：
 * - **描述折行**：非 TTY 时 helpWidth 恒为 80，长描述会折到描述列（缩进远大于
 *   条目的 2 空格），故「缩进恰好 2 且首字符符合条目形态」才是新条目；
 * - **必填不可见**：commander 的 `requiredOption` 在 help 里与普通 option 同形，
 *   故本解析器**不产出必填性**——真正的强制交给 CLI 自身报错。
 * @module @dsh-plus/actual-mcp/help
 */

/** 一个 commander 本地选项的类型化事实。 */
export interface CliOption {
  /** 长名（去前导短横线），如 `server-url`、`no-cache`。 */
  name: string
  shorthand?: string
  /** 取值占位符（如 `url`）；缺失 = 布尔开关。 */
  value?: string
  /** 已剥离 `(choices: …)` / `(default: …)` 元数据的描述。 */
  description: string
  /** `(choices: "a", "b")` 解析结果。 */
  choices?: string[]
  /** `(default: …)` 原文。 */
  default?: string
  /** 描述声明从 stdin 读取（`--file <path>` 的 `-`），执行面不支持。 */
  stdin: boolean
}

/** 一条子命令。 */
export interface CliSubcommand {
  name: string
  short: string
  /** 该子命令自身的位置参数（取自 Commands 行，如 `update … <id>` 的 `id`）。 */
  positionals: string[]
}

/** 一条 `actual <family> [action] --help` 的结构化结果。 */
export interface CommanderHelp {
  /** Usage 行原文（折行时以空格连接）。 */
  usage: string
  /** 首段短描述（折行已还原）。 */
  short: string
  /** 必填位置参数名（Usage 顺序）。 */
  positionals: string[]
  /** 可选位置参数名（`[dest]` 形态）。 */
  optionalPositionals: string[]
  /** 子命令（已剔除 help）。 */
  subcommands: CliSubcommand[]
  /** 本地选项（已剔除 -h/--help 与 -V/--version）。 */
  options: CliOption[]
}

/** commander 的条目缩进恒为 2 空格；描述列远在其右。 */
const ENTRY_INDENT = 2

/** 取行首空格数。 */
function indentOf(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0
}

/**
 * 把条目行拆成 term / description。
 * @param line - 原始行。
 * @param isTerm - term 形态判定（选项以 `-` 起、子命令以标识符起）。
 */
function splitEntry(
  line: string,
  isTerm: (term: string) => boolean,
): { term: string; description: string } | undefined {
  if (indentOf(line) !== ENTRY_INDENT) return undefined
  const body = line.slice(ENTRY_INDENT)
  if (body.trim() === '') return undefined
  const match = /^(.*?)\s{2,}(.*)$/.exec(body)
  const term = (match === null ? body : (match[1] ?? '')).trim()
  if (!isTerm(term)) return undefined
  return { term, description: (match === null ? '' : (match[2] ?? '')).trim() }
}

/** 迭代某一段的条目行（含折行续接），逐条回调。 */
function forEachEntry(
  lines: string[],
  title: string,
  isTerm: (term: string) => boolean,
  onEntry: (entry: { term: string; description: string }) => void,
): void {
  const start = lines.findIndex((line) => line.trim() === title)
  if (start < 0) return
  let current: { term: string; description: string } | undefined
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') break
    const entry = splitEntry(line, isTerm)
    if (entry !== undefined) {
      current = entry
      onEntry(entry)
      continue
    }
    // 折行续接：描述列远在条目缩进右侧，拼回当前条目。
    if (current !== undefined) {
      current.description = `${current.description} ${line.trim()}`.trim()
      onEntry(current)
    }
  }
}

/** 按 Usage 顺序提取位置参数；`[options]`/`[command]` 是 commander 占位符。 */
export function parseUsagePositionals(usage: string): { required: string[]; optional: string[] } {
  const required: string[] = []
  const optional: string[] = []
  for (const token of usage.trim().split(/\s+/)) {
    if (token === '[options]' || token === '[command]') continue
    const req = /^<(.+)>$/.exec(token)
    if (req?.[1] !== undefined) {
      required.push(req[1])
      continue
    }
    const opt = /^\[(.+)\]$/.exec(token)
    if (opt?.[1] !== undefined) optional.push(opt[1])
  }
  return { required, optional }
}

/** `(choices: "a", "b", default: "a")` → `['a','b']`。 */
function extractChoices(description: string): string[] | undefined {
  const match = /\(\s*choices:\s*([^)]*)\)/.exec(description)
  if (match === null) return undefined
  const body = (match[1] ?? '').split(/,\s*(?=default\s*:)/)[0] ?? ''
  const values = [...body.matchAll(/"([^"]*)"/g)].map((found) => found[1] ?? '')
  return values.length > 0 ? values : undefined
}

/** 取最后一个 `default: …)` 的值（`(choices: …, default: "json")` 也命中）。 */
function extractDefault(description: string): string | undefined {
  let found: string | undefined
  for (const match of description.matchAll(/\bdefault:\s*([^,)]+)\)/g)) {
    found = (match[1] ?? '').trim()
  }
  return found
}

/** 剥离 `(choices: …)` / `(default: …)` 元数据；`(env: …)` 一类说明保留。 */
function stripMeta(description: string): string {
  return description.replace(/\s*\(\s*(?:choices|default):[^()]*\)/g, '').trim()
}

/** 选项 term → 结构；非选项形态返回 undefined。 */
function parseOptionTerm(
  term: string,
): { name: string; shorthand?: string; value?: string } | undefined {
  const match =
    /^(?:(-[A-Za-z0-9]),\s+)?(-{1,2}[A-Za-z0-9][A-Za-z0-9-]*)(?:\s+(<[^>]+>|\[[^\]]+\]))?$/.exec(
      term,
    )
  if (match === null) return undefined
  const name = (match[2] ?? '').replace(/^-+/, '')
  const parsed: { name: string; shorthand?: string; value?: string } = { name }
  if (match[1] !== undefined) parsed.shorthand = match[1].replace(/^-/, '')
  const value = match[3]
  if (value !== undefined) parsed.value = value.replace(/^[<[]|[>\]]$/g, '')
  return parsed
}

/** 子命令 term（`update [options] <id>`）→ 名称与位置参数。 */
function parseCommandTerm(term: string): { name: string; positionals: string[] } | undefined {
  const tokens = term.trim().split(/\s+/)
  const name = tokens[0]
  if (name === undefined || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return undefined
  const positionals: string[] = []
  for (const token of tokens.slice(1)) {
    const match = /^<(.+)>$/.exec(token)
    if (match?.[1] !== undefined) positionals.push(match[1])
  }
  return { name, positionals }
}

/** 解析 Options 段（`help` 与 `-V/--version` 剔除）。 */
function parseOptionSection(lines: string[]): CliOption[] {
  const options: CliOption[] = []
  const seen = new Set<string>()
  forEachEntry(
    lines,
    'Options:',
    (term) => term.startsWith('-'),
    ({ term, description: raw }) => {
      const parsed = parseOptionTerm(term)
      if (parsed === undefined) return
      if (parsed.name === 'help' || (parsed.name === 'version' && parsed.shorthand === 'V')) return
      const choices = extractChoices(raw)
      const fallback = extractDefault(raw)
      const option: CliOption = {
        name: parsed.name,
        description: stripMeta(raw),
        stdin: /\bstdin\b/i.test(raw),
      }
      if (parsed.shorthand !== undefined) option.shorthand = parsed.shorthand
      if (parsed.value !== undefined) option.value = parsed.value
      if (choices !== undefined) option.choices = choices
      if (fallback !== undefined) option.default = fallback
      // 折行续接会重复回调同一条目：以名称去重并覆盖为最新（含完整描述）。
      if (seen.has(option.name)) {
        const index = options.findIndex((candidate) => candidate.name === option.name)
        options[index] = option
        return
      }
      seen.add(option.name)
      options.push(option)
    },
  )
  return options
}

/** 解析 Commands 段（`help` 剔除）。 */
function parseCommandSection(lines: string[]): CliSubcommand[] {
  const subcommands: CliSubcommand[] = []
  const seen = new Map<string, number>()
  forEachEntry(
    lines,
    'Commands:',
    (term) => /^[A-Za-z0-9]/.test(term),
    ({ term, description }) => {
      const parsed = parseCommandTerm(term)
      if (parsed === undefined || parsed.name === 'help') return
      const existing = seen.get(parsed.name)
      if (existing !== undefined) {
        const slot = subcommands[existing]
        if (slot !== undefined) slot.short = description
        return
      }
      seen.set(parsed.name, subcommands.length)
      subcommands.push({ name: parsed.name, short: description, positionals: parsed.positionals })
    },
  )
  return subcommands
}

/** 收集 Usage 行（折行以空格连接）。 */
function collectUsage(lines: string[], usageIndex: number): string {
  if (usageIndex < 0) return ''
  const parts = [(lines[usageIndex] ?? '').replace(/^Usage:\s*/, '').trim()]
  for (let i = usageIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') break
    parts.push(line.trim())
  }
  return parts.filter((part) => part !== '').join(' ')
}

/** 收集 Usage 之后的首段描述（折行以空格连接）。 */
function collectShort(lines: string[], usageIndex: number): string {
  const parts: string[] = []
  let started = false
  for (let i = usageIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      if (started) break
      continue
    }
    started = true
    parts.push(line.trim())
  }
  return parts.join(' ')
}

/**
 * 解析一条 commander help 输出。
 * @param text - help 原文（仅 stdout；CLI 的 Error 行走 stderr 不混入）。
 * @returns 结构化事实；Usage 缺失时各字段为空。
 */
export function parseCommanderHelp(text: string): CommanderHelp {
  const lines = text.split(/\r?\n/)
  const usageIndex = lines.findIndex((line) => /^Usage:/.test(line))
  const usage = collectUsage(lines, usageIndex)
  const positionals = parseUsagePositionals(usage)
  return {
    usage,
    short: collectShort(lines, usageIndex),
    positionals: positionals.required,
    optionalPositionals: positionals.optional,
    subcommands: parseCommandSection(lines),
    options: parseOptionSection(lines),
  }
}
