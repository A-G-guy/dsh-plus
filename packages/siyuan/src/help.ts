/**
 * cobra `kernel … --help` 文本解析（纯函数，fixture 单测钉住）。
 *
 * 只解析派生工具所需的事实：短描述、Usage 行（位置参数与必选 flag）、
 * 子命令表、本地 Flags（排除 Global Flags 与 --help）。
 * @module @dsh-plus/siyuan/help
 */

/** 一个 cobra 本地 flag 的类型化事实。 */
export interface CliFlag {
  name: string
  shorthand?: string
  /** cobra 类型记号；缺记号按 bool（存在即真）处理。 */
  type: 'string' | 'stringArray' | 'int' | 'bool'
  description: string
  /** Usage 行以 `--name <x>` 形式出现 = 必选。 */
  required: boolean
}

/** 一条 `kernel <family> --help` 的结构化结果。 */
export interface KernelHelp {
  /** 首行短描述。 */
  short: string
  /** Usage 原行（诊断用）。 */
  usage: string
  /** 位置参数名（按 Usage 顺序，如 `statement`、`query`）。 */
  positionals: string[]
  /** 子命令（已剔除 help/completion）。 */
  subcommands: { name: string; short: string }[]
  flags: CliFlag[]
}

const FLAG_LINE = /^\s+(?:-(\w),\s+)?--([\w-]+)(?:\s+(string|stringArray|int|bool))?\s+(.*)$/
const SUBCOMMAND_LINE = /^ {2}(\S+)\s+(.*)$/

/** 解析 Usage 行，提取位置参数与必选 flag 名。 */
export function parseUsage(usage: string): { positionals: string[]; requiredFlags: Set<string> } {
  const positionals: string[] = []
  const requiredFlags = new Set<string>()
  const tokens = usage.trim().split(/\s+/)
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === undefined || token === '[flags]' || token === '[command]') continue
    if (token.startsWith('--')) {
      const next = tokens[i + 1]
      if (next?.startsWith('<') === true) {
        requiredFlags.add(token.slice(2))
        i += 1 // 占位符随 flag 消费，不得再被当成位置参数
      }
      continue
    }
    if (token.startsWith('<')) positionals.push(token.replace(/[<>]/g, ''))
  }
  return { positionals, requiredFlags }
}

/** 解析 `Flags:` 段（停在 `Global Flags:` 或段尾），跳过 --help。 */
function parseFlags(lines: string[]): CliFlag[] {
  const flags: CliFlag[] = []
  for (const line of lines) {
    const match = FLAG_LINE.exec(line)
    if (match === null) continue
    const [, shorthand, name, type, description] = match
    if (name === undefined || name === 'help') continue
    const flag: CliFlag = {
      name,
      type: (type ?? 'bool') as CliFlag['type'],
      description: (description ?? '').trim(),
      required: false,
    }
    if (shorthand !== undefined) flag.shorthand = shorthand
    flags.push(flag)
  }
  return flags
}

/**
 * 解析一条 `kernel <family> --help` 输出。
 * @param text - help 原文（仅 stdout；Error 行走 stderr 不混入）。
 * @returns 结构化事实；Usage 缺失时 positionals/flags 为空、short 为空串。
 */
export function parseKernelHelp(text: string): KernelHelp {
  const lines = text.split(/\r?\n/)
  const usageIndex = lines.findIndex((line) => line.trim() === 'Usage:')
  const short = (
    usageIndex > 0 ? (lines.slice(0, usageIndex).find((l) => l.trim() !== '') ?? '') : ''
  ).trim()
  const usage = usageIndex >= 0 ? (lines[usageIndex + 1] ?? '').trim() : ''
  const { positionals, requiredFlags } = parseUsage(usage)

  const commandsIndex = lines.findIndex((line) => line.trim() === 'Available Commands:')
  const subcommands: { name: string; short: string }[] = []
  if (commandsIndex >= 0) {
    for (const line of lines.slice(commandsIndex + 1)) {
      if (line.trim() === '') break
      const match = SUBCOMMAND_LINE.exec(line)
      if (match === null) continue
      const [, name, subShort] = match
      if (name === undefined || name === 'help' || name === 'completion') continue
      subcommands.push({ name, short: (subShort ?? '').trim() })
    }
  }

  const flagsIndex = lines.findIndex((line) => line.trim() === 'Flags:')
  const flagsEnd = lines.findIndex((line, i) => i > flagsIndex && line.trim() === 'Global Flags:')
  const flags = parseFlags(
    flagsIndex >= 0 ? lines.slice(flagsIndex + 1, flagsEnd >= 0 ? flagsEnd : undefined) : [],
  )
  for (const flag of flags) flag.required = requiredFlags.has(flag.name)

  return { short, usage, positionals, subcommands, flags }
}
