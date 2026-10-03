/**
 * 配置卡片草稿的纯逻辑（无 React/JSX，供 node --test 直接导入）：
 * 解析值 → 草稿、草稿 → 提交形状，以及优先级列表与超时的校验。
 * @module web-search-services/client/draft
 */
import type { SearchBackend } from '../config.ts'

/** 可选后端（与 config.ts 的 PRIORITY_ENTRY union 同源顺序）。 */
export const SEARCH_BACKENDS: readonly SearchBackend[] = ['tavily', 'exa', 'openai-chat']

/** 默认后端顺序（与 config.ts 的 DEFAULT_PRIORITY 一致）。 */
export const DEFAULT_PRIORITY: readonly SearchBackend[] = ['tavily', 'exa', 'openai-chat']

/** 单次搜索子进程超时下限（与 config.ts 的 .min(1000) 一致）。 */
export const TIMEOUT_MIN_MS = 1000

/** settings 命名空间的解析值（keys 内 secret 字段已被 describe 层遮蔽，卡片不消费）。 */
export interface ConfigValue {
  scriptPath: string
  envFile: string
  python: string
  priority: SearchBackend[]
  timeoutMs: number
}

/** 编辑草稿：字符串字段原样，数组与数值以文本承载（保存时校验并折算）。 */
export interface Draft {
  scriptPath: string
  envFile: string
  python: string
  priorityText: string
  timeoutMsText: string
}

export function draftFromValue(value: ConfigValue): Draft {
  return {
    scriptPath: value.scriptPath,
    envFile: value.envFile,
    python: value.python,
    priorityText: value.priority.join('\n'),
    timeoutMsText: String(value.timeoutMs),
  }
}

/** 优先级文本 → 后端序列；顺带返回无法识别的行（供 UI 提示）。 */
export function parsePriority(text: string): {
  backends: SearchBackend[]
  unknown: string[]
  duplicated: string[]
} {
  const backends: SearchBackend[] = []
  const unknown: string[] = []
  const duplicated: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const match = SEARCH_BACKENDS.find((backend) => backend === line)
    if (match === undefined) {
      unknown.push(line)
      continue
    }
    if (backends.includes(match)) {
      duplicated.push(line)
      continue
    }
    backends.push(match)
  }
  return { backends, unknown, duplicated }
}

/** 优先级是否可用：至少一个后端、无未知项、无重复项。 */
export function priorityTextOk(text: string): boolean {
  const { backends, unknown, duplicated } = parsePriority(text)
  return backends.length > 0 && unknown.length === 0 && duplicated.length === 0
}

/** 超时是否可用：≥1000 的整数（对齐 schema 的 .natural().min(1000)）。 */
export function timeoutTextOk(text: string): boolean {
  if (!/^\d+$/.test(text.trim())) return false
  return Number(text) >= TIMEOUT_MIN_MS
}

/** 草稿 → 提交形状（调用方保证已通过校验）。 */
export function toPatch(draft: Draft): Record<string, unknown> {
  return {
    scriptPath: draft.scriptPath,
    envFile: draft.envFile,
    python: draft.python,
    priority: parsePriority(draft.priorityText).backends,
    timeoutMs: Number(draft.timeoutMsText),
  }
}
