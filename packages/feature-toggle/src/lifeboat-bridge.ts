/**
 * lifeboat 隔离记录识别（零依赖单向读取，不 import 兄弟包）。
 *
 * lifeboat 的 journal 持久化在其 settings 命名空间 dsh-plus-lifeboat（封顶 50 条），
 * kind=quarantine 的条目 detail 以插件名开头（「<name>（来源 …」）。此处从中
 * 提取被隔离插件名集合，用于：
 * 1. 启用被隔离的 dsh-plus 插件前拒绝写入（避免与救生艇对抗）；
 * 2. patch 文件中同形条目的归属判定（外部条目只增不删）。
 *
 * 读取失败（lifeboat 缺席/命名空间未注册/数据形状变化）一律视为无记录——
 * lifeboat 是独立防线，本插件不得因它的缺席或异常而起不来。
 * @module feature-toggle/lifeboat-bridge
 */
import type { Context } from '@deepseek-ai/cordis'

const LIFEBOAT_NS = 'dsh-plus-lifeboat'

/** lifeboat journal 条目的最小投影。 */
interface LifeboatJournalEntry {
  at?: unknown
  kind?: unknown
  detail?: unknown
}

interface LifeboatDoc {
  journal?: unknown
}

/** 从单条 quarantine detail 提取插件名（格式「<name>（来源 …」）。 */
export function pluginNameFromDetail(detail: unknown): string | null {
  if (typeof detail !== 'string' || detail.length === 0) return null
  const match = /^([a-z0-9][a-z0-9-]*)（/.exec(detail)
  return match?.[1] ?? null
}

/** 从 journal 文档提取被隔离插件名集合（纯函数，可测）。 */
export function quarantinedNamesFromDoc(doc: unknown): Set<string> {
  const names = new Set<string>()
  const journal = (doc as LifeboatDoc | null | undefined)?.journal
  if (!Array.isArray(journal)) return names
  for (const entry of journal as LifeboatJournalEntry[]) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.kind !== 'quarantine') continue
    const name = pluginNameFromDetail(entry.detail)
    if (name !== null) names.add(name)
  }
  return names
}

/**
 * 读取当前 lifeboat 隔离集合。任何异常都吞掉返回空集（见模块注释）。
 */
export function readQuarantined(ctx: Context): Set<string> {
  try {
    const settings = (ctx as unknown as { get?: (key: string) => unknown }).get?.('settings') as
      | { get?: (ns: string) => unknown }
      | undefined
    if (settings?.get === undefined) return new Set()
    const doc = settings.get(LIFEBOAT_NS)
    if (doc === undefined) return new Set()
    return quarantinedNamesFromDoc(doc)
  } catch {
    return new Set()
  }
}
