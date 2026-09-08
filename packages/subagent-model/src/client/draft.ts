/**
 * 配置卡片的可编辑草稿模型：ConfigValue ↔ Draft 转换与提交补丁（纯函数，
 * 与渲染分离以便单测）。行集合 = 目录返回的已注册子代理 provider ∪ 已配置条目；
 * 未配置的新 provider 行以默认空值落盘（自文档化）。
 * @module subagent-model/client/draft
 */
import type { ModelCatalog } from './api.ts'

/** settings 命名空间的解析值（无 secret 字段）。 */
export interface ConfigValue {
  enabled: boolean
  entries: Record<string, WireEntry>
}

export interface WireEntry {
  enabled: boolean
  provider: string
  model: string
  reasoningEffort: string
}

export interface DraftRow {
  enabled: boolean
  provider: string
  model: string
  reasoningEffort: string
}

export interface Draft {
  enabled: boolean
  rows: Record<string, DraftRow>
}

export const EMPTY_ROW: DraftRow = {
  enabled: false,
  provider: '',
  model: '',
  reasoningEffort: 'inherit',
}

/** 行集 = 目录 subagentProviders ∪ 已配置条目；目录行缺省为空行。 */
export function draftFrom(value: ConfigValue, catalog: ModelCatalog | null): Draft {
  const rows: Record<string, DraftRow> = {}
  const names = new Set<string>()
  for (const name of catalog?.subagentProviders ?? []) names.add(name)
  for (const name of Object.keys(value.entries).sort()) names.add(name)
  for (const name of names) {
    const entry = value.entries[name]
    rows[name] =
      entry === undefined
        ? { ...EMPTY_ROW }
        : {
            enabled: entry.enabled,
            provider: entry.provider,
            model: entry.model,
            reasoningEffort: entry.reasoningEffort,
          }
  }
  return { enabled: value.enabled, rows }
}

export function toPatch(draft: Draft): Record<string, unknown> {
  // entries 按键排序物化：dirty 比较走 JSON.stringify，而草稿的播种路径
  // （先 entries 后补目录空行）与 draftFrom（先目录后 entries）键序不同，
  // 不排序会出现「未改动却永久 dirty」的假阳性。
  const entries: Record<string, DraftRow> = {}
  for (const name of Object.keys(draft.rows).sort()) entries[name] = draft.rows[name]
  return { enabled: draft.enabled, entries }
}
