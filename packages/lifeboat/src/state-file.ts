/**
 * journal 与 LLM 应急翻译状态的文件持久化（$DSH_HOME/dsh-plus/lifeboat/state.json）。
 *
 * 存储规范：运行期状态属非配置数据，不进 settings.yaml；本模块自带实现，
 * 维持零 dsh-plus 内部依赖铁律（不 import @dsh-plus/shared）。
 * schema 刻意宽松：lifeboat 是最后防线，自身数据问题绝不能让它起不来。
 * @module lifeboat/state-file
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { FallbackStateT, JournalEntryT } from './config.ts'

/** 状态文件落点：$DSH_HOME/dsh-plus/lifeboat/state.json。 */
export const STATE_FILE = dshHomePath('dsh-plus', 'lifeboat', 'state.json')

/** 磁盘文档形状（与旧 settings 命名空间同构，仅位置不同）。 */
export interface StateDoc {
  journal: JournalEntryT[]
  llmFallback: FallbackStateT | null
}

/** journal 上限：只留最近 50 条，防长期运行膨胀。 */
const JOURNAL_CAP = 50

/** 文件大小上限：超出即视为损坏，丢弃重来（journal 本身封顶 50 条）。 */
const MAX_BYTES = 256 * 1024

/** 未知输入收窄为合法 journal 条目（宽松承载数据问题）。 */
function asEntry(value: unknown): JournalEntryT | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record['at'] !== 'string' || typeof record['kind'] !== 'string') return null
  return { at: record['at'], kind: record['kind'], detail: String(record['detail'] ?? '') }
}

/** 未知输入收窄为合法翻译状态。 */
function asFallback(value: unknown): FallbackStateT | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record['active'] !== 'boolean') return null
  return {
    active: record['active'],
    originalProvider: String(record['originalProvider'] ?? ''),
    originalModel: String(record['originalModel'] ?? ''),
    fallbackProvider: String(record['fallbackProvider'] ?? ''),
    providers: Array.isArray(record['providers'])
      ? record['providers'].map((item) => String(item))
      : [],
    at: String(record['at'] ?? ''),
  }
}

/** 未知输入收窄为完整状态文档；任何缺省回落到空文档。 */
export function normalizeState(raw: unknown): StateDoc {
  if (typeof raw !== 'object' || raw === null) return { journal: [], llmFallback: null }
  const record = raw as Record<string, unknown>
  const journal = Array.isArray(record['journal'])
    ? record['journal'].map(asEntry).filter((entry): entry is JournalEntryT => entry !== null)
    : []
  return { journal: journal.slice(-JOURNAL_CAP), llmFallback: asFallback(record['llmFallback']) }
}

/** 读取状态文件；缺失/损坏/超限时返回空文档（最后防线不得因自身数据起不来）。 */
export async function loadState(): Promise<StateDoc> {
  try {
    const info = await stat(STATE_FILE)
    if (!info.isFile() || info.size > MAX_BYTES) return { journal: [], llmFallback: null }
    return normalizeState(JSON.parse(await readFile(STATE_FILE, 'utf-8')))
  } catch {
    return { journal: [], llmFallback: null }
  }
}

/** 原子写状态文件：临时文件 + rename，写入失败仅告警不抛出。 */
export async function saveState(doc: StateDoc, warn: (message: string) => void): Promise<void> {
  try {
    await mkdir(dirname(STATE_FILE), { recursive: true })
    const tmp = `${STATE_FILE}.tmp`
    await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8')
    await rename(tmp, STATE_FILE)
  } catch (error) {
    warn(`状态文件写入失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 追加一条 journal（内存文档已更新后调用；落盘失败不阻断动作）。 */
export function appendJournal(doc: StateDoc, kind: string, detail: string): StateDoc {
  return {
    ...doc,
    journal: [...doc.journal, { at: new Date().toISOString(), kind, detail }].slice(-JOURNAL_CAP),
  }
}
