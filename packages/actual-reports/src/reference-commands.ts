/**
 * `reference` 族动作实现：把「定制组件/报表要用的官方语义」从本机就地取出来。
 *
 * 三类来源，都是**本地**的（不联网翻官方仓库）：
 * - 本机官方 CLI 自带的 `@actual-app/core` 源码：组件类型与 meta 字段、实验开关全集；
 * - 服务端静态托管的 Web 客户端源码（source map）：界面侧语义与字面量核对；
 * - 当前预算的 `preferences`：实验开关、周首、货币等偏好的真实取值。
 * @module @dsh-plus/actual-reports/reference-commands
 */

import {
  type ActionContext,
  type ActionFlags,
  type ActionResult,
  boolFlag,
  stringFlag,
} from './action.ts'
import { resolveCoreDir } from './api.ts'
import {
  type ClientSourceIndex,
  grepSources,
  listSources,
  loadClientSources,
  type SourceMatch,
} from './client-source.ts'
import { loadFeatureFlags, loadWidgetModel, type WidgetTypeDoc } from './core-model.ts'
import { type CoreTree, grepCoreFiles, listCoreFiles, readCoreFile } from './core-source.ts'
import {
  BALANCE_TYPE_OP,
  DATE_RANGE_SPEC,
  GROUP_BY_KEYS,
  INTERVAL_SPEC,
  MODE_KEYS,
  SORT_BY_KEYS,
} from './model.ts'
import { readPreferences, summarizePrefs } from './prefs.ts'
import { renderTable } from './render.ts'

/** 客户端资产默认读取份数上限（每份 source map 数 MB，够用即可）。 */
const DEFAULT_MAX_ASSETS = 8

/** `source --file` 单文件正文上限。 */
const FILE_LIMIT = 60000

/** 读整数参数（缺省用默认值，非整数即报错）。 */
function intFlag(flags: ActionFlags, prop: string, fallback: number): number {
  const raw = stringFlag(flags, prop)
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`参数 --${prop} 需要非负整数，实际为 ${JSON.stringify(raw)}`)
  }
  return value
}

/** 官方界面新增组件时的默认几何（客户端源码里的新增逻辑：4×2，桑基图 3 高）。 */
const UI_DEFAULTS = {
  width: 4,
  height: 2,
  heightByType: { 'sankey-card': 3 },
  meta: null,
  layout: '省略 x/y 时由服务端自动排版（12 列网格）；只给一个会被官方 schema 拒绝。',
} as const

/** 取字段类型里引用到的类型名（用于挑出要一并返回的共享类型）。 */
function referencedNames(types: WidgetTypeDoc[]): Set<string> {
  const names = new Set<string>()
  for (const type of types) {
    for (const field of type.fields) {
      for (const match of field.type.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(match[0])
    }
  }
  return names
}

/** 按需返回共享类型：给了 `--type` 就只带它引用到的（含一层展开），否则全带。 */
function sharedTypesFor(
  model: Awaited<ReturnType<typeof loadWidgetModel>>,
  types: WidgetTypeDoc[],
  filtered: boolean,
): typeof model.sharedTypes {
  if (!filtered) return model.sharedTypes
  const wanted = referencedNames(types)
  for (const name of [...wanted]) {
    const doc = model.sharedTypes.find((item) => item.name === name)
    if (doc === undefined) continue
    for (const match of doc.body.matchAll(/[A-Za-z_$][\w$]*/g)) wanted.add(match[0])
  }
  return model.sharedTypes.filter((item) => wanted.has(item.name))
}

/** `reference widgets`：组件类型与 meta 字段。 */
async function actionWidgets(context: ActionContext): Promise<ActionResult> {
  const coreDir = await resolveCoreDir(context.local.config, context.local.io)
  const model = await loadWidgetModel(coreDir, context.local.io)
  const only = stringFlag(context.flags, 'type')
  const types = only === undefined ? model.types : model.types.filter((item) => item.type === only)
  if (types.length === 0) {
    throw new Error(
      `本机模型里没有组件类型 ${JSON.stringify(only)}。可用类型：${model.types.map((item) => item.type).join(' / ')}`,
    )
  }
  const sharedTypes = sharedTypesFor(model, types, only !== undefined)
  const payload = {
    action: 'reference widgets',
    source: model.path,
    uiDefaults: UI_DEFAULTS,
    types,
    sharedTypes,
  }
  const text = [
    `组件模型来源：${model.path}`,
    `共 ${types.length} 个类型（meta 可省略，省略即 null，由服务端按类型补默认）。`,
    '',
    renderTable(
      ['类型', 'meta 字段'],
      types.map((item) => [
        item.type,
        item.fields
          .map((field) => `${field.name}${field.optional ? '?' : ''}: ${field.type}`)
          .join('; '),
      ]),
    ),
  ].join('\n')
  return { payload, text }
}

/** `reference prefs`：预算偏好与实验开关。 */
async function actionPrefs(context: ActionContext): Promise<ActionResult> {
  const coreDir = await resolveCoreDir(context.local.config, context.local.io)
  const [rows, flags] = await Promise.all([
    readPreferences(context.access),
    loadFeatureFlags(coreDir, context.local.io),
  ])
  const summary = summarizePrefs(rows, flags.flags)
  const enabled = summary.flags.filter((item) => item.enabled)
  const payload = {
    action: 'reference prefs',
    flagsSource: flags.path,
    flags: summary.flags,
    enabledFlags: enabled.map((item) => item.flag),
    prefs: summary.prefs,
  }
  const text = [
    `实验开关来源：${flags.path}（取值来自当前预算的 preferences 表）。`,
    `已开启：${enabled.length === 0 ? '（无）' : enabled.map((item) => item.flag).join('、')}`,
    '',
    renderTable(
      ['开关', '存储键', '取值', '是否开启'],
      summary.flags.map((item) => [
        item.flag,
        item.prefId,
        item.value ?? '（未设置）',
        item.enabled ? '是' : '否',
      ]),
    ),
    '',
    `预算偏好共 ${rows.length} 项。`,
  ].join('\n')
  return { payload, text }
}

/** 源码检索的目标种类。 */
type SourceKind = 'core' | 'client' | 'all'

/** 读 `--kind`（默认 all）。 */
function kindOf(flags: ActionFlags): SourceKind {
  const raw = stringFlag(flags, 'kind')
  if (raw === undefined || raw === 'all') return 'all'
  if (raw === 'core' || raw === 'client') return raw
  throw new Error(`参数 --kind 只接受 core / client / all，实际为 ${JSON.stringify(raw)}`)
}

/** 本次要搜索的源码集合。 */
interface SourceContext {
  core?: { dir: string; tree: CoreTree }
  client?: ClientSourceIndex
}

/** 按 kinds 准备源码集合（core 列文件树，client 按需拉 source map）。 */
async function prepareSources(
  context: ActionContext,
  kind: SourceKind,
  match: string | undefined,
  maxAssets: number,
): Promise<SourceContext> {
  const prepared: SourceContext = {}
  if (kind !== 'client') {
    const dir = await resolveCoreDir(context.local.config, context.local.io)
    const options = match === undefined ? {} : { match }
    prepared.core = { dir, tree: await listCoreFiles(dir, context.local.io, options) }
  }
  if (kind !== 'core') {
    prepared.client = await loadClientSources(context.local.config, context.local.io, maxAssets)
  }
  return prepared
}

/** 汇总覆盖率信息（列出读到的路径与资产）。 */
function coverageOf(sources: SourceContext, kind: SourceKind): Record<string, unknown> {
  const coverage: Record<string, unknown> = { kind }
  if (sources.core !== undefined) {
    coverage.core = {
      root: sources.core.tree.root,
      files: sources.core.tree.paths.length,
      truncated: sources.core.tree.truncated,
    }
  }
  if (sources.client !== undefined) {
    coverage.client = {
      serverUrl: sources.client.serverUrl,
      assetsRead: sources.client.searched.length,
      assetsSkipped: sources.client.skipped.length,
      files: new Set(sources.client.entries.map((entry) => entry.path)).size,
    }
  }
  return coverage
}

/** `--list`：列出可读源码路径。 */
function listAction(sources: SourceContext, match: string | undefined): ActionResult {
  const paths = [
    ...(sources.core?.tree.paths ?? []),
    ...(sources.client === undefined ? [] : listSources(sources.client, match)),
  ]
  const payload = {
    action: 'reference source',
    mode: 'list',
    coverage: coverageOf(sources, 'all'),
    paths,
  }
  return { payload, text: [`可读源码 ${paths.length} 份：`, ...paths].join('\n') }
}

/** `--grep`：正则检索。 */
async function grepAction(
  context: ActionContext,
  sources: SourceContext,
  pattern: string,
): Promise<ActionResult> {
  const max = intFlag(context.flags, 'max', 40)
  const contextLines = intFlag(context.flags, 'context', 0)
  let matches: SourceMatch[] = []
  let truncated = false
  let scanned = 0
  if (sources.core !== undefined) {
    const result = await grepCoreFiles(
      sources.core.dir,
      context.local.io,
      sources.core.tree,
      pattern,
      { context: contextLines, max },
    )
    matches = [...matches, ...result.matches]
    truncated = truncated || result.truncated
    scanned += result.scanned
  }
  if (sources.client !== undefined) {
    const result = grepSources(sources.client, pattern, { context: contextLines, max })
    matches = [...matches, ...result.matches]
    truncated = truncated || result.truncated
    scanned += sources.client.entries.length
  }
  const bounded = matches.slice(0, max)
  const payload = {
    action: 'reference source',
    mode: 'grep',
    pattern,
    coverage: coverageOf(sources, 'all'),
    scanned,
    truncated: truncated || matches.length > bounded.length,
    matches: bounded,
  }
  const text = [
    `命中 ${bounded.length} 处（扫描 ${scanned} 份源码${truncated ? '，已达上限' : ''}）：`,
    ...bounded.map((item) => `${item.path}:${item.line}\n${item.text}`),
  ].join('\n')
  return { payload, text }
}

/** `--file`：读一份源码。 */
async function fileAction(
  context: ActionContext,
  sources: SourceContext,
  path: string,
): Promise<ActionResult> {
  const fromCore =
    sources.core === undefined ? undefined : await readCoreFileOptional(context, sources, path)
  const text =
    fromCore ?? (sources.client === undefined ? undefined : readOptional(sources.client, path))
  if (text === undefined) {
    const wanted = path
    throw new Error(
      `本次源码集合里没有 ${wanted}。用 \`reference source --list\` 看可读路径；` +
        '客户端源码没读全时可加大 --max-assets 或改用 --kind core。',
    )
  }
  if (text.length > FILE_LIMIT) {
    throw new Error(
      `${path} 正文 ${text.length} 字节，超过单次上限 ${FILE_LIMIT}：请改用 ` +
        `\`reference source --grep <正则>\` 定位片段，或按需读更小的文件。`,
    )
  }
  const payload = {
    action: 'reference source',
    mode: 'file',
    coverage: coverageOf(sources, 'all'),
    path,
    text,
  }
  return { payload, text }
}

/** core 侧读文件（不在树里就返回 undefined）。 */
async function readCoreFileOptional(
  context: ActionContext,
  sources: SourceContext,
  path: string,
): Promise<string | undefined> {
  if (sources.core === undefined) return undefined
  if (!sources.core.tree.paths.includes(path)) return undefined
  return await readCoreFile(sources.core.dir, context.local.io, path)
}

/** client 侧读文件（没有就返回 undefined）。 */
function readOptional(index: ClientSourceIndex, path: string): string | undefined {
  const found = index.entries.find((entry) => entry.path === path)
  return found?.text
}

/** `reference source`：本机源码检索。 */
async function actionSource(context: ActionContext): Promise<ActionResult> {
  const kind = kindOf(context.flags)
  const wantsList = boolFlag(context.flags, 'list')
  const grep = stringFlag(context.flags, 'grep')
  const file = stringFlag(context.flags, 'file')
  const chosen = [wantsList, grep !== undefined, file !== undefined].filter(Boolean).length
  if (chosen !== 1) {
    throw new Error(
      '请且仅请给出一种用法：--list（列路径）、--grep <正则>（检索）或 --file <路径>（读一份）。',
    )
  }
  const match = stringFlag(context.flags, 'match')
  const maxAssets = intFlag(context.flags, 'maxAssets', DEFAULT_MAX_ASSETS)
  const sources = await prepareSources(context, kind, match, maxAssets)
  if (wantsList) return listAction(sources, match)
  if (grep !== undefined) return await grepAction(context, sources, grep)
  return await fileAction(context, sources, file as string)
}

/** `reference report-options`：报表词汇表（可选用本机客户端资产核对）。 */
async function actionReportOptions(context: ActionContext): Promise<ActionResult> {
  const vocabulary = {
    dateRange: Object.keys(DATE_RANGE_SPEC),
    dateRangeNote:
      '实时区间（isDateStatic=false）；静态区间用 isDateStatic=true + startDate/endDate（yyyy-MM-dd）。',
    interval: Object.keys(INTERVAL_SPEC),
    groupBy: GROUP_BY_KEYS,
    balanceType: Object.keys(BALANCE_TYPE_OP),
    sortBy: SORT_BY_KEYS,
    mode: MODE_KEYS,
    graphType:
      '原样透传（官方取值随图谱而变，如 BarGraph / LineGraph / TableGraph / DonutGraph）：本包不校验。',
  }
  const verify = boolFlag(context.flags, 'verify')
  const payload: Record<string, unknown> = { action: 'reference report-options', ...vocabulary }
  if (verify) {
    const index = await loadClientSources(
      context.local.config,
      context.local.io,
      intFlag(context.flags, 'maxAssets', DEFAULT_MAX_ASSETS),
    )
    payload.verified = verifyVocabulary(index, vocabulary)
  }
  const text = [
    `实时区间：${vocabulary.dateRange.join(' / ')}`,
    `粒度：${vocabulary.interval.join(' / ')}`,
    `分组：${vocabulary.groupBy.join(' / ')}`,
    `口径：${vocabulary.balanceType.join(' / ')}`,
    `排序：${vocabulary.sortBy.join(' / ')}`,
    vocabulary.dateRangeNote,
  ].join('\n')
  return { payload, text }
}

/** 逐条核对词汇字面量是否出现在本次读到的客户端源码里。 */
function verifyVocabulary(
  index: ClientSourceIndex,
  vocabulary: Record<string, unknown>,
): { assetsRead: number; filesRead: number; found: string[]; missing: string[] } {
  const haystack = index.entries.map((entry) => entry.text).join('\n')
  const candidates = [
    ...(vocabulary.dateRange as string[]),
    ...(vocabulary.interval as string[]),
    ...(vocabulary.groupBy as string[]),
    ...(vocabulary.balanceType as string[]),
    ...(vocabulary.sortBy as string[]),
  ]
  const found = candidates.filter(
    (item) => haystack.includes(`'${item}'`) || haystack.includes(`"${item}"`),
  )
  const missing = candidates.filter((item) => !found.includes(item))
  return {
    assetsRead: index.searched.length,
    filesRead: index.entries.length,
    found,
    missing,
  }
}

/** 动作名 → 执行器。 */
const HANDLERS: Record<string, (context: ActionContext) => Promise<ActionResult>> = {
  widgets: actionWidgets,
  prefs: actionPrefs,
  source: actionSource,
  'report-options': actionReportOptions,
}

/**
 * 执行一个 `reference` 动作。
 * @throws 未知动作时抛出（动作表与执行器不同步属接线错误）。
 */
export async function runReferenceAction(
  action: string,
  context: ActionContext,
): Promise<ActionResult> {
  const handler = HANDLERS[action]
  if (handler === undefined) {
    throw new Error(`reference 族没有动作 ${action}（动作表与执行器不同步）`)
  }
  return await handler(context)
}
