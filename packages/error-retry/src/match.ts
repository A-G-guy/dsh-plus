/**
 * 报错匹配：把配置模式编译成对 failure.message 的谓词。
 *
 * 两种模式形态（纯函数，无 IO）：
 * - 正则形：`/source/flags`（以 / 起止且非空）；未携带 i 标志时自动补 i，
 *   使 `content[-_]filter` 这类模式大小写不敏感；
 * - 模糊子串形：两侧统一「小写 + 空格/连字符/下划线折叠为单个下划线」后做
 *   包含判断，因此 `content-filter`、`CONTENT_FILTER`、`finish reason`
 *   都能命中实际消息 `Provider finish_reason: content_filter`。
 *
 * 匹配目标只有 failure.message，不含 code——code 是全大写下划线形态
 * （如 PI_AI_ERROR），子串匹配极易误命中。
 * @module @dsh-plus/error-retry/match
 */

/** 已编译的单个模式：保留配置原文供日志，携带求值谓词。 */
export interface CompiledPattern {
  /** 配置中的模式原文（日志上下文用）。 */
  readonly pattern: string
  /** 对 failure.message 求值的谓词。 */
  readonly test: (message: string) => boolean
}

/** 模糊子串归一：小写 + 分隔符（空白/连字符/下划线）折叠为单个 `_`。 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s_-]+/g, '_')
}

/** `/source/flags` 的解析结果；非正则形返回 undefined。 */
function parseRegexForm(pattern: string): RegExp | undefined {
  if (!pattern.startsWith('/') || pattern.length < 3) return undefined
  const end = pattern.lastIndexOf('/')
  if (end <= 0) return undefined
  const source = pattern.slice(1, end)
  const flags = pattern.slice(end + 1)
  return new RegExp(source, flags.includes('i') ? flags : `${flags}i`)
}

/**
 * 编译单个模式。正则形语法错误时抛错——配置问题应在插件装载期暴露，
 * 而非运行期静默不命中。
 * @param pattern - 配置中的单条模式。
 * @returns 带原文的编译模式。
 */
export function compilePattern(pattern: string): CompiledPattern {
  const regex = parseRegexForm(pattern)
  if (regex !== undefined) return { pattern, test: (message) => regex.test(message) }
  const needle = normalize(pattern)
  return { pattern, test: (message) => normalize(message).includes(needle) }
}

/**
 * 编译全部模式（保序）。
 * @param patterns - 配置的模式列表（可为空，空列表恒不命中）。
 * @returns 编译模式列表。
 */
export function compilePatterns(patterns: readonly string[]): CompiledPattern[] {
  return patterns.map(compilePattern)
}

/**
 * 查找首个命中的模式。
 * @param compiled - compilePatterns 的产物。
 * @param message - failure.message。
 * @returns 首个命中项；无命中返回 undefined。
 */
export function findMatchedPattern(
  compiled: readonly CompiledPattern[],
  message: string,
): CompiledPattern | undefined {
  return compiled.find(({ test }) => test(message))
}
