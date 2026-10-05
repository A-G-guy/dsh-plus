/**
 * 本机官方模型源码的解析：`@actual-app/core` 的组件模型与实验开关清单。
 *
 * **不内置模型快照**——组件类型、meta 字段、实验开关都随服务端版本变，写死的快照
 * 迟早静默过时（模型照旧「成功」写入，界面却渲染不出来）。因此这里每次现场解析
 * 本机已安装的那份源码，解析不出来就显式报错，绝不猜。
 *
 * 只提取**结构事实**（类型名、字段名、字段类型、可选性、字面量联合），不搬运实现。
 * @module @dsh-plus/actual-reports/core-model
 */

import { joinPath, type ReportsIo } from './node-io.ts'

/** 组件 meta 里的一个字段。 */
export interface WidgetFieldDoc {
  name: string
  /** 字段类型文本（原样，如 `string` / `'trend' | 'stacked'` / `TimeFrame`）。 */
  type: string
  optional: boolean
}

/** 一个组件类型的 meta 结构。 */
export interface WidgetTypeDoc {
  type: string
  /** meta 是否允许 null（=`meta` 可省略，服务端会补默认）。 */
  nullable: boolean
  fields: WidgetFieldDoc[]
}

/** 同文件里的共享类型（字段引用到它时在同一份输出里就能查到）。 */
export interface SharedTypeDoc {
  name: string
  body: string
  truncated: boolean
}

/** 组件模型（来源：本机 core 的 dashboard 模型源码）。 */
export interface WidgetModel {
  path: string
  types: WidgetTypeDoc[]
  sharedTypes: SharedTypeDoc[]
}

/** 实验开关清单（来源：本机 core 的 prefs 类型声明）。 */
export interface FeatureFlagList {
  path: string
  flags: string[]
}

/** 共享类型正文的长度上限（超出截断，避免一次输出把上下文吃光）。 */
const SHARED_TYPE_LIMIT = 700

/** 读源码文件，缺失即显式报错。 */
async function readSource(io: ReportsIo, path: string, hint: string): Promise<string> {
  const text = await io.fs.readText(path)
  if (text === undefined) {
    throw new Error(
      `读不到官方模型源码：${path}。${hint}（用 \`reference source --list --kind core\` 可核对本机源码树）。`,
    )
  }
  return text
}

/** 去掉注释（字符串字面量内的注释符号不收，模型源码里没有这种写法）。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** 压缩空白（字段类型与类型正文都按单行呈现）。 */
function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 从 `start`（指向 `<` 或 `{`）找到配对的闭合位置；找不到返回 -1。 */
function matchPair(text: string, start: number): number {
  const open = text[start] as string
  const close = open === '<' ? '>' : open === '{' ? '}' : open === '(' ? ')' : ''
  if (close === '') return -1
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/** 按顶层分隔符切分（忽略嵌套括号内的分隔符）。 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '{' || char === '<' || char === '(' || char === '[') depth += 1
    else if (char === '}' || char === '>' || char === ')' || char === ']') depth -= 1
    if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/** 解析 meta 对象字面量里的字段。 */
function parseFields(objectBody: string): WidgetFieldDoc[] {
  const fields: WidgetFieldDoc[] = []
  for (const segment of splitTopLevel(objectBody, ';')) {
    const piece = compact(segment)
    if (piece === '') continue
    const match = /^([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/.exec(piece)
    if (match === null) continue
    fields.push({
      name: match[1] as string,
      optional: match[2] === '?',
      type: compact(match[3] as string),
    })
  }
  return fields
}

/** 解析一个 `AbstractWidget<'type', Meta>` 声明。 */
function parseWidget(text: string, start: number): WidgetTypeDoc | undefined {
  const open = text.indexOf('<', start)
  if (open === -1) return undefined
  const close = matchPair(text, open)
  if (close === -1) return undefined
  const body = text.slice(open + 1, close)
  const typeMatch = /^\s*'([^']+)'\s*,\s*([\s\S]*)$/.exec(body)
  if (typeMatch === null) return undefined
  const meta = (typeMatch[2] as string).trim()
  const braceAt = meta.indexOf('{')
  const nullable = /\bnull\b/.test(meta)
  if (braceAt === -1) return { type: typeMatch[1] as string, nullable, fields: [] }
  const braceEnd = matchPair(meta, braceAt)
  if (braceEnd === -1) return undefined
  return {
    type: typeMatch[1] as string,
    nullable,
    fields: parseFields(meta.slice(braceAt + 1, braceEnd)),
  }
}

/** 解析 `export type X = …;` 声明（正文按顶层 `;` 收束）。 */
function parseSharedTypes(text: string): SharedTypeDoc[] {
  const docs: SharedTypeDoc[] = []
  const pattern = /export type\s+([A-Za-z_$][\w$]*)\s*=\s*/g
  for (const match of text.matchAll(pattern)) {
    const name = match[1] as string
    const bodyStart = (match.index ?? 0) + match[0].length
    const rest = text.slice(bodyStart)
    let depth = 0
    let end = -1
    for (let index = 0; index < rest.length; index += 1) {
      const char = rest[index]
      if (char === '{' || char === '<' || char === '(' || char === '[') depth += 1
      else if (char === '}' || char === '>' || char === ')' || char === ']') depth -= 1
      else if (char === ';' && depth === 0) {
        end = index
        break
      }
    }
    const raw = compact(end === -1 ? rest.slice(0, SHARED_TYPE_LIMIT) : rest.slice(0, end))
    docs.push({
      name,
      body: raw.length > SHARED_TYPE_LIMIT ? `${raw.slice(0, SHARED_TYPE_LIMIT)}…` : raw,
      truncated: raw.length > SHARED_TYPE_LIMIT,
    })
  }
  return docs
}

/** dashboard 模型源码的相对路径。 */
const DASHBOARD_MODEL = ['src', 'types', 'models', 'dashboard.ts']

/** prefs 类型源码的相对路径。 */
const PREFS_TYPES = ['src', 'types', 'prefs.ts']

/**
 * 读取本机的组件模型。
 * @throws 源码缺失或解析不出任何组件类型时抛出（不回落任何内置副本）。
 */
export async function loadWidgetModel(coreDir: string, io: ReportsIo): Promise<WidgetModel> {
  const path = joinPath(coreDir, ...DASHBOARD_MODEL)
  const text = stripComments(
    await readSource(io, path, '官方 CLI 里应自带 @actual-app/core 的源码'),
  )
  const types: WidgetTypeDoc[] = []
  for (const match of text.matchAll(/AbstractWidget\s*</g)) {
    const doc = parseWidget(text, match.index ?? 0)
    if (doc !== undefined) types.push(doc)
  }
  if (types.length === 0) {
    throw new Error(
      `从 ${path} 里解析不出任何组件类型（官方模型源码的结构可能变了）。` +
        '请用 `reference source --file src/types/models/dashboard.ts --kind core` 直接读源码。',
    )
  }
  return { path, types, sharedTypes: parseSharedTypes(text) }
}

/** 读取实验开关清单（`FeatureFlag` 联合的字面量）。 */
export async function loadFeatureFlags(coreDir: string, io: ReportsIo): Promise<FeatureFlagList> {
  const path = joinPath(coreDir, ...PREFS_TYPES)
  const text = stripComments(
    await readSource(io, path, '官方 CLI 里应自带 @actual-app/core 的源码'),
  )
  const declaration = /export type\s+FeatureFlag\s*=\s*([\s\S]*?);/.exec(text)
  if (declaration === null) {
    throw new Error(
      `从 ${path} 里找不到 FeatureFlag 声明（官方 prefs 类型可能变了）。` +
        '请用 `reference source --file src/types/prefs.ts --kind core` 直接读源码。',
    )
  }
  const flags = [...(declaration[1] as string).matchAll(/'([^']+)'/g)].map(
    (item) => item[1] as string,
  )
  if (flags.length === 0) throw new Error(`${path} 的 FeatureFlag 声明里没有任何字面量`)
  return { path, flags }
}
