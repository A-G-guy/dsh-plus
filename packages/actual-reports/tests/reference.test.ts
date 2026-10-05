/**
 * `reference` 族的行为测试：本机模型解析、偏好与实验开关、源码检索（core/client）、
 * 报表词汇核对，以及各条失败路径是否显式报错。
 *
 * 替身只提供「本机资产」与「服务端应答」，因此这里断言的是本包怎么用它们、
 * 读不到时怎么说，而不是官方源码自身的内容。
 * @module @dsh-plus/actual-reports/tests/reference
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ActionAccess, ActionContext } from '../src/action.ts'
import { runReferenceAction } from '../src/reference-commands.ts'
import { fakeLocal } from './fixtures/local-deps.ts'

/** 假的 core 包根。 */
const CORE = '/opt/core'

/** 模型源码：两个类型 + 一个共享类型（结构与官方模型同形）。 */
const DASHBOARD_MODEL = `type AbstractWidget<
  T extends string,
  Meta extends Record<string, unknown> | null = null,
> = { id: string; type: T; meta: Meta };

export type TimeFrame = {
  start: string;
  end: string;
  mode: 'static' | 'full';
};

export type SummaryWidget = AbstractWidget<
  'summary-card',
  {
    name?: string;
    timeFrame?: TimeFrame;
    // 注释应被剥掉
    content?: string;
  } | null
>;

export type MarkdownWidget = AbstractWidget<
  'markdown-card',
  { content: string; text_align?: 'left' | 'right' | 'center' }
>;

export type FormulaWidget = AbstractWidget<
  'formula-card',
  {
    name?: string;
    queries?: Record<
      string,
      {
        conditionsOp?: 'and' | 'or';
      }
    >;
  } | null
>;
`

/** prefs 源码：实验开关全集。 */
const PREFS_TYPES = `export type FeatureFlag =
  | 'formulaMode'
  | 'sankeyReport'
  | 'monteCarloReport';
`

/** 本机 core 源码树替身。 */
function coreFiles(): Record<string, string> {
  return {
    [`${CORE}/src/types/models/dashboard.ts`]: DASHBOARD_MODEL,
    [`${CORE}/src/types/prefs.ts`]: PREFS_TYPES,
    [`${CORE}/src/server/reports/app.ts`]: "export const note = 'report handler';\n",
  }
}

/** 造一个本地动作上下文（预算访问一律报错：本地动作不应碰它）。 */
function localContext(
  options: {
    flags?: ActionContext['flags']
    files?: Record<string, string>
    http?: Record<string, string | { status: number } | undefined>
  } = {},
): ActionContext {
  const local = fakeLocal({
    config: { coreDir: CORE, dataDir: '/tmp/data' },
    files: { ...coreFiles(), ...(options.files ?? {}) },
    ...(options.http === undefined ? {} : { http: options.http }),
  })
  const deny = (): never => {
    throw new Error('本地动作不应访问预算')
  }
  const access = {
    api: { q: deny, aqlQuery: deny },
    call: deny,
  } as unknown as ActionAccess
  return {
    access,
    flags: options.flags ?? {},
    format: 'json',
    today: '2025-03-15',
    local: { config: local.config, io: local.io },
  }
}

/** 造一个只答偏好查询的预算访问面。 */
function prefsAccess(rows: { id: string; value: string }[]): ActionAccess {
  const builder = { select: () => builder }
  return {
    api: {
      q: () => builder,
      aqlQuery: async () => ({ data: rows }),
    },
    call: async () => undefined,
  } as unknown as ActionAccess
}

/** 取载荷（收窄成可索引对象）。 */
function payloadOf(result: { payload: unknown }): Record<string, unknown> {
  return result.payload as Record<string, unknown>
}

test('widgets：解析出类型、meta 字段（含可选性）与共享类型', async () => {
  const result = await runReferenceAction('widgets', localContext())
  const payload = payloadOf(result)
  const types = payload.types as { type: string; nullable: boolean; fields: unknown[] }[]
  assert.deepEqual(
    types.map((item) => item.type),
    ['summary-card', 'markdown-card', 'formula-card'],
  )
  const summary = types.find((item) => item.type === 'summary-card')
  assert.equal(summary?.nullable, true)
  assert.deepEqual(summary?.fields, [
    { name: 'name', type: 'string', optional: true },
    { name: 'timeFrame', type: 'TimeFrame', optional: true },
    { name: 'content', type: 'string', optional: true },
  ])
  const markdown = types.find((item) => item.type === 'markdown-card')
  assert.equal(markdown?.nullable, false)
  const shared = payload.sharedTypes as { name: string; body: string }[]
  const timeFrame = shared.find((item) => item.name === 'TimeFrame')
  assert.match(timeFrame?.body ?? '', /mode: 'static' \| 'full'/)
  assert.equal(payload.source, `${CORE}/src/types/models/dashboard.ts`)
  // 多行的嵌套字段也要整体取到（正文里的分号不能把字段截断）
  const formula = types.find((item) => item.type === 'formula-card')
  assert.deepEqual(formula?.fields, [
    { name: 'name', type: 'string', optional: true },
    {
      name: 'queries',
      type: "Record< string, { conditionsOp?: 'and' | 'or'; } >",
      optional: true,
    },
  ])
})

test('widgets：--type 收窄，只带该类型引用到的共享类型；未知类型显式报错', async () => {
  const result = await runReferenceAction(
    'widgets',
    localContext({ flags: { type: 'summary-card' } }),
  )
  const payload = payloadOf(result)
  const types = payload.types as { type: string }[]
  assert.deepEqual(
    types.map((item) => item.type),
    ['summary-card'],
  )
  const shared = (payload.sharedTypes as { name: string }[]).map((item) => item.name)
  assert.ok(shared.includes('TimeFrame'))
  assert.ok(!shared.includes('MarkdownWidget'))

  await assert.rejects(
    async () => await runReferenceAction('widgets', localContext({ flags: { type: 'nope-card' } })),
    /本机模型里没有组件类型 "nope-card"。可用类型：summary-card \/ markdown-card \/ formula-card/,
  )
})

test('widgets：模型源码缺失或结构不符时显式报错，不回落内置副本', async () => {
  const missing = localContext({
    files: { [`${CORE}/src/types/models/dashboard.ts`]: undefined as unknown as string },
  })
  const withoutModel = fakeLocal({
    config: { coreDir: CORE },
    files: { [`${CORE}/src/types/prefs.ts`]: PREFS_TYPES },
  })
  await assert.rejects(
    async () =>
      await runReferenceAction('widgets', {
        ...missing,
        local: { config: withoutModel.config, io: withoutModel.io },
      }),
    /--core-dir 指向的目录里没有 src\/types\/models\/dashboard\.ts/,
  )

  const flat = localContext({
    files: { [`${CORE}/src/types/models/dashboard.ts`]: 'export const nothing = 1\n' },
  })
  await assert.rejects(
    async () => await runReferenceAction('widgets', flat),
    /解析不出任何组件类型/,
  )
})

test('prefs：实验开关取自预算偏好，未设置按未开启处理', async () => {
  const context = localContext()
  const withAccess: ActionContext = {
    ...context,
    access: prefsAccess([
      { id: 'firstDayOfWeekIdx', value: '1' },
      { id: 'flags.formulaMode', value: 'true' },
      { id: 'flags.sankeyReport', value: 'false' },
    ]),
  }
  const result = await runReferenceAction('prefs', withAccess)
  const payload = payloadOf(result)
  assert.deepEqual(payload.enabledFlags, ['formulaMode'])
  const flags = payload.flags as { flag: string; value: string | null; enabled: boolean }[]
  assert.deepEqual(
    flags.map((item) => [item.flag, item.value, item.enabled]),
    [
      ['formulaMode', 'true', true],
      ['sankeyReport', 'false', false],
      ['monteCarloReport', null, false],
    ],
  )
  assert.equal((payload.prefs as Record<string, string>).firstDayOfWeekIdx, '1')
})

test('source --list：列本机 core 源码路径，可按子串过滤', async () => {
  const result = await runReferenceAction(
    'source',
    localContext({ flags: { list: true, kind: 'core' } }),
  )
  const paths = payloadOf(result).paths as string[]
  assert.deepEqual(paths, [
    'src/server/reports/app.ts',
    'src/types/models/dashboard.ts',
    'src/types/prefs.ts',
  ])

  const filtered = await runReferenceAction(
    'source',
    localContext({ flags: { list: true, kind: 'core', match: 'types/' } }),
  )
  assert.deepEqual(payloadOf(filtered).paths, [
    'src/types/models/dashboard.ts',
    'src/types/prefs.ts',
  ])
})

test('source --grep：命中带行号，--context 带上下文行', async () => {
  const result = await runReferenceAction(
    'source',
    localContext({ flags: { grep: "'markdown-card'", kind: 'core', context: '1' } }),
  )
  const matches = payloadOf(result).matches as { path: string; line: number; text: string }[]
  assert.equal(matches.length, 1)
  assert.equal(matches[0]?.path, 'src/types/models/dashboard.ts')
  const expectedLine =
    DASHBOARD_MODEL.split('\n').findIndex((line) => line.includes("'markdown-card'")) + 1
  assert.equal(matches[0]?.line, expectedLine)
  assert.match(matches[0]?.text ?? '', /markdown-card/)

  await assert.rejects(
    async () =>
      await runReferenceAction('source', localContext({ flags: { grep: '(', kind: 'core' } })),
    /--grep 不是合法正则/,
  )
})

test('source --file：读正文；越界、超限、路径不存在都显式报错', async () => {
  const result = await runReferenceAction(
    'source',
    localContext({ flags: { file: 'src/types/prefs.ts', kind: 'core' } }),
  )
  assert.equal(payloadOf(result).text, PREFS_TYPES)

  await assert.rejects(
    async () =>
      await runReferenceAction(
        'source',
        localContext({ flags: { file: 'src/types/none.ts', kind: 'core' } }),
      ),
    /本次源码集合里没有 src\/types\/none\.ts/,
  )
  await assert.rejects(
    async () =>
      await runReferenceAction(
        'source',
        localContext({ flags: { file: '../../etc/passwd', kind: 'core' } }),
      ),
    /本次源码集合里没有/,
  )
  await assert.rejects(
    async () =>
      await runReferenceAction(
        'source',
        localContext({
          flags: { file: 'src/big.ts', kind: 'core' },
          files: { [`${CORE}/src/big.ts`]: 'x'.repeat(70000) },
        }),
      ),
    /超过单次上限/,
  )
})

test('source：必须且只能给一种用法', async () => {
  await assert.rejects(
    async () => await runReferenceAction('source', localContext({ flags: { kind: 'core' } })),
    /请且仅请给出一种用法/,
  )
  await assert.rejects(
    async () =>
      await runReferenceAction(
        'source',
        localContext({ flags: { list: true, file: 'src/types/prefs.ts', kind: 'core' } }),
      ),
    /请且仅请给出一种用法/,
  )
  await assert.rejects(
    async () =>
      await runReferenceAction('source', localContext({ flags: { list: true, kind: 'x' } })),
    /--kind 只接受 core \/ client \/ all/,
  )
})

/** 客户端资产替身：首页 → 入口 bundle → 两个 chunk 的 source map。 */
function clientHttp(): Record<string, string> {
  const base = 'http://127.0.0.1:5006'
  const entry = `${base}/static/js/index.ABC.js`
  const chunk = `${base}/static/js/ReportRouter.XYZ.chunk.js`
  const theme = `${base}/static/js/theme.XYZ.chunk.js`
  return {
    [`${base}/`]: `<script type="module" src="/static/js/index.ABC.js"></script>`,
    [entry]: `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["static/js/ReportRouter.XYZ.chunk.js","static/js/theme.XYZ.chunk.js"])));`,
    [`${chunk}.map`]: JSON.stringify({
      sources: ['../../../src/components/reports/ReportOptions.ts'],
      sourcesContent: ["export const dateRangeOptions = ['This month', 'Last 6 months'];\n"],
    }),
    [`${theme}.map`]: JSON.stringify({
      sources: ['../../../src/theme.ts'],
      sourcesContent: ["export const theme = 'dark';\n"],
    }),
  }
}

test('source --kind client：发现服务端资产、检索并读源码，结果进缓存', async () => {
  const local = fakeLocal({
    config: { coreDir: CORE, dataDir: '/tmp/data' },
    files: coreFiles(),
    http: clientHttp(),
  })
  const context: ActionContext = {
    ...localContext(),
    local: { config: local.config, io: local.io },
  }
  const listed = await runReferenceAction('source', {
    ...context,
    flags: { list: true, kind: 'client' },
  })
  const paths = payloadOf(listed).paths as string[]
  assert.deepEqual(paths, ['src/components/reports/ReportOptions.ts', 'src/theme.ts'])

  const grepped = await runReferenceAction('source', {
    ...context,
    flags: { grep: 'dateRangeOptions', kind: 'client' },
  })
  const matches = payloadOf(grepped).matches as { path: string; line: number }[]
  assert.deepEqual(matches, [
    {
      path: 'src/components/reports/ReportOptions.ts',
      line: 1,
      text: "export const dateRangeOptions = ['This month', 'Last 6 months'];",
    },
  ])

  const read = await runReferenceAction('source', {
    ...context,
    flags: { file: 'src/theme.ts', kind: 'client' },
  })
  assert.equal(payloadOf(read).text, "export const theme = 'dark';\n")

  // 缓存：第二次检索不再重取已成功读到的 source map（首页 HTML 每次都要读，用于发现新版本资产；
  // 取不到的 map 不缓存，下次仍会试一次）
  const goodMaps = [
    'http://127.0.0.1:5006/static/js/ReportRouter.XYZ.chunk.js.map',
    'http://127.0.0.1:5006/static/js/theme.XYZ.chunk.js.map',
  ]
  for (const url of goodMaps) assert.equal(local.requests.filter((item) => item === url).length, 1)
  await runReferenceAction('source', {
    ...context,
    flags: { grep: 'dateRangeOptions', kind: 'client' },
  })
  for (const url of goodMaps) assert.equal(local.requests.filter((item) => item === url).length, 1)
})

test('source --kind client：source map 缺失时显式报错并给替代路径', async () => {
  const base = 'http://127.0.0.1:5006'
  const local = fakeLocal({
    config: { coreDir: CORE, dataDir: '/tmp/data' },
    files: coreFiles(),
    http: {
      [`${base}/`]: `<script src="/static/js/index.ABC.js"></script>`,
      [`${base}/static/js/index.ABC.js`]: `d=(m.f||(m.f=["static/js/only.XYZ.chunk.js"]))`,
      [`${base}/static/js/only.XYZ.chunk.js.map`]: { status: 404 },
    },
  })
  await assert.rejects(
    async () =>
      await runReferenceAction('source', {
        ...localContext(),
        flags: { list: true, kind: 'client' },
        local: { config: local.config, io: local.io },
      }),
    /没有可用的客户端 source map/,
  )
})

test('source --kind client：服务端连不上时显式报错', async () => {
  const local = fakeLocal({ config: { coreDir: CORE } })
  await assert.rejects(
    async () =>
      await runReferenceAction('source', {
        ...localContext(),
        flags: { list: true, kind: 'client' },
        local: { config: local.config, io: local.io },
      }),
    /连不上 Actual 服务端/,
  )
})

test('report-options：给出报表词汇；--verify 用本机客户端资产逐字核对', async () => {
  const plain = await runReferenceAction('report-options', localContext())
  const payload = payloadOf(plain)
  assert.ok((payload.dateRange as string[]).includes('Last 6 months'))
  assert.ok((payload.groupBy as string[]).includes('Category'))
  assert.ok((payload.balanceType as string[]).includes('Net Payment'))
  assert.equal(payload.verified, undefined)

  const local = fakeLocal({
    config: { coreDir: CORE, dataDir: '/tmp/data' },
    files: coreFiles(),
    http: {
      'http://127.0.0.1:5006/': `<script src="/static/js/index.ABC.js"></script>`,
      'http://127.0.0.1:5006/static/js/index.ABC.js': `d=(m.f||(m.f=["static/js/r.XYZ.chunk.js"]))`,
      'http://127.0.0.1:5006/static/js/r.XYZ.chunk.js.map': JSON.stringify({
        sources: ['../../../src/options.ts'],
        sourcesContent: ["const ranges = ['Last 6 months'];\nconst groups = ['Category'];\n"],
      }),
    },
  })
  const verified = await runReferenceAction('report-options', {
    ...localContext(),
    flags: { verify: true },
    local: { config: local.config, io: local.io },
  })
  const report = payloadOf(verified).verified as { found: string[]; missing: string[] }
  assert.ok(report.found.includes('Last 6 months'))
  assert.ok(report.found.includes('Category'))
  assert.ok(report.missing.includes('This week'))
})
