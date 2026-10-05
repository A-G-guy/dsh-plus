/**
 * 伙伴 CLI 的端到端行为测试（argv → 会话 → handler → 输出）：
 * 读写边界、缓存复用、删除保护、以及各类用法错误的退出码与文案。
 * @module @dsh-plus/actual-reports/tests/cli
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { LoadedApi } from '../src/api.ts'
import { type CliRuntime, runCli } from '../src/cli.ts'
import { createNodeIo } from '../src/node-io.ts'
import { type FakeBudgetFixture, fakeBudget } from './fixtures/fake-budget.ts'

/** 一次 CLI 调用的观测面。 */
interface Harness {
  runtime: CliRuntime
  output: string[]
  errors: string[]
  apiCalls: string[]
  dataDir: string
}

/** 已存报表定义（供读回断言）。 */
const STORED_REPORT = {
  id: 'rep-1',
  name: '月度分类',
  startDate: '2025-01-01',
  endDate: '2025-02-28',
  isDateStatic: true,
  dateRange: 'Last 6 months',
  mode: 'total',
  groupBy: 'Category',
  sortBy: 'desc',
  interval: 'Monthly',
  balanceType: 'Payment',
  showEmpty: false,
  showOffBudget: false,
  showHiddenCategories: true,
  showUncategorized: true,
  trimIntervals: false,
  showTrendLines: false,
  includeCurrentInterval: true,
  graphType: 'BarGraph',
  conditions: [],
  conditionsOp: 'and',
}

/** 造一个 CLI 运行环境（含临时缓存目录与记录用的 api 包装）。 */
async function harness(
  fixture: FakeBudgetFixture,
  files: Record<string, string> = {},
): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-reports-cli-'))
  const fake = fakeBudget(fixture)
  const apiCalls: string[] = []
  const wrapped = {
    ...fake.api,
    downloadBudget: async (syncId: string, options?: { password?: string }) => {
      apiCalls.push('downloadBudget')
      await fake.api.downloadBudget(syncId, options)
    },
    loadBudget: async (id: string) => {
      apiCalls.push('loadBudget')
      await fake.api.loadBudget(id)
    },
    sync: async () => {
      apiCalls.push('sync')
      await fake.api.sync()
    },
  }
  const io = {
    ...createNodeIo(),
    env: {
      ACTUAL_SERVER_URL: 'http://127.0.0.1:5006',
      ACTUAL_PASSWORD: 'pw',
      ACTUAL_SYNC_ID: 'sync-1',
      ACTUAL_DATA_DIR: dataDir,
    },
  }
  const output: string[] = []
  const errors: string[] = []
  const runtime: CliRuntime = {
    io,
    write: (text) => output.push(text),
    writeError: (text) => errors.push(text),
    readTextFile: async (path) => files[path],
    loadApi: async (): Promise<LoadedApi> => ({
      path: '/fake/@actual-app/api/index.js',
      module: wrapped,
    }),
  }
  return { runtime, output, errors, apiCalls, dataDir }
}

/** 解析唯一一条 stdout 输出为 JSON。 */
function jsonOf(harnessed: Harness): Record<string, unknown> {
  const text = harnessed.output.join('\n').trim()
  return JSON.parse(text) as Record<string, unknown>
}

/** 解析 stderr 上的结构化错误。 */
function errorOf(harnessed: Harness): string {
  const text = harnessed.errors.join('\n').trim()
  const parsed = JSON.parse(text) as { error?: { message?: string } }
  return parsed.error?.message ?? ''
}

const FIXTURE: FakeBudgetFixture = {
  reports: [STORED_REPORT],
  categories: [
    { id: 'cat-food', name: 'Food', hidden: 0, group: 'grp-1', sort_order: 1 },
    { id: 'cat-rent', name: 'Rent', hidden: 0, group: 'grp-1', sort_order: 2 },
  ],
  categoryGroups: [{ id: 'grp-1', name: 'Living', hidden: 0, is_income: 0, sort_order: 1 }],
  payees: [{ id: 'pay-1', name: 'Shop', transfer_acct: null }],
  accounts: [{ id: 'acc-1', name: 'Checking', offbudget: 0 }],
  earliest: '2025-01-01',
  latest: '2025-02-28',
  assets: [
    {
      date: '2025-01',
      category: 'cat-food',
      categoryHidden: false,
      categoryGroup: 'grp-1',
      categoryGroupHidden: false,
      account: 'acc-1',
      accountOffBudget: false,
      payee: 'pay-1',
      transferAccount: null,
      amount: 10_000,
    },
  ],
  debts: [
    {
      date: '2025-02',
      category: 'cat-food',
      categoryHidden: false,
      categoryGroup: 'grp-1',
      categoryGroupHidden: false,
      account: 'acc-1',
      accountOffBudget: false,
      payee: 'pay-1',
      transferAccount: null,
      amount: -4_000,
    },
  ],
}

test('report list：读出已存报表并首次下载预算', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    const code = await runCli(['report', 'list'], harnessed.runtime)
    assert.equal(code, 0)
    const payload = jsonOf(harnessed)
    assert.equal(payload.action, 'report list')
    assert.deepEqual(
      (payload.reports as Record<string, unknown>[]).map((item) => item.id),
      ['rep-1'],
    )
    assert.deepEqual(harnessed.apiCalls, ['downloadBudget'])
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('report data：按已存报表算数，第二次走缓存不重复下载', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    const first = await runCli(['report', 'data', '--report-id', 'rep-1'], harnessed.runtime)
    assert.equal(first, 0)
    const payload = jsonOf(harnessed)
    assert.equal(payload.amountUnit, 'cents')
    assert.deepEqual(payload.totals, {
      assets: 10_000,
      debts: -4_000,
      netAssets: 10_000,
      netDebts: -4_000,
      totals: 6_000,
    })
    assert.deepEqual(payload.intervals, ['2025-01', '2025-02'])

    harnessed.output.length = 0
    const second = await runCli(['report', 'data', '--report-id', 'rep-1'], harnessed.runtime)
    assert.equal(second, 0)
    assert.deepEqual(harnessed.apiCalls, ['downloadBudget', 'loadBudget'])
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('report data --definition：临时定义试算并支持 --today 复现', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    const definition = JSON.stringify({
      name: '临时',
      isDateStatic: false,
      dateRange: 'This month',
      interval: 'Monthly',
      groupBy: 'Category',
      balanceType: 'Net',
    })
    const code = await runCli(
      ['report', 'data', '--definition', definition, '--today', '2025-02-10'],
      harnessed.runtime,
    )
    assert.equal(code, 0)
    const payload = jsonOf(harnessed)
    assert.equal(payload.startDate, '2025-02-01')
    assert.equal(payload.endDate, '2025-02-28')
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('report create/update：写动作会 sync，且读回服务端结果', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    const created = await runCli(
      ['report', 'create', '--definition', JSON.stringify({ name: '新报表' })],
      harnessed.runtime,
    )
    assert.equal(created, 0)
    assert.equal(jsonOf(harnessed).id, 'created-report-id')
    assert.ok(harnessed.apiCalls.includes('sync'))

    harnessed.output.length = 0
    const updated = await runCli(
      [
        'report',
        'update',
        '--report-id',
        'rep-1',
        '--overrides',
        JSON.stringify({ name: '改名后' }),
      ],
      harnessed.runtime,
    )
    assert.equal(updated, 0)
    assert.equal((jsonOf(harnessed).report as Record<string, unknown>).name, '改名后')
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('report delete：被仪表盘组件引用时拒绝，--force 时连带移除组件', async () => {
  const referenced: FakeBudgetFixture = {
    ...FIXTURE,
    dashboard: [
      {
        id: 'w-1',
        dashboard_page_id: 'page-1',
        type: 'custom-report',
        meta: '{"id":"rep-1"}',
        tombstone: 0,
      },
      { id: 'w-2', dashboard_page_id: 'page-1', type: 'markdown-card', meta: '{}', tombstone: 0 },
    ],
  }
  const blocked = await harness(referenced)
  try {
    const code = await runCli(['report', 'delete', '--report-id', 'rep-1'], blocked.runtime)
    assert.equal(code, 1)
    assert.match(errorOf(blocked), /正被 1 个仪表盘组件引用/)
    assert.equal(blocked.apiCalls.includes('sync'), false, '被拒绝时不应回写')
  } finally {
    await rm(blocked.dataDir, { recursive: true, force: true })
  }

  const forced = await harness(referenced)
  try {
    const code = await runCli(
      ['report', 'delete', '--report-id', 'rep-1', '--force'],
      forced.runtime,
    )
    assert.equal(code, 0)
    const payload = jsonOf(forced)
    assert.deepEqual(payload.removedWidgets, [{ pageId: 'page-1', widgetId: 'w-1' }])
    assert.ok(forced.apiCalls.includes('sync'))
  } finally {
    await rm(forced.dataDir, { recursive: true, force: true })
  }
})

test('report get：找不到时报错并列出可选项', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    const code = await runCli(['report', 'get', '--name', '不存在'], harnessed.runtime)
    assert.equal(code, 1)
    assert.match(
      errorOf(harnessed),
      /找不到报表：name = "不存在"。当前预算里的报表：月度分类\(rep-1\)/,
    )
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('用法错误：未知选项/缺必填/stdin 形态/未知族都是退出码 2', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    assert.equal(await runCli(['report', 'list', '--nope'], harnessed.runtime), 2)
    assert.match(errorOf(harnessed), /未知选项 --nope/)

    harnessed.errors.length = 0
    assert.equal(await runCli(['report', 'create'], harnessed.runtime), 2)
    assert.match(errorOf(harnessed), /缺少必填选项 --definition/)

    harnessed.errors.length = 0
    assert.equal(await runCli(['report', 'data', '--definition', '@-'], harnessed.runtime), 2)
    assert.match(errorOf(harnessed), /不支持 stdin 形态（@-）/)

    harnessed.errors.length = 0
    assert.equal(await runCli(['payees', 'list'], harnessed.runtime), 2)
    assert.match(errorOf(harnessed), /未知的命令族：payees/)
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('@file 形态读取 JSON，且文件不存在时报错', async () => {
  const harnessed = await harness(FIXTURE, {
    '/tmp/def.json': JSON.stringify({ name: '来自文件' }),
  })
  try {
    const code = await runCli(
      ['report', 'create', '--definition', '@/tmp/def.json'],
      harnessed.runtime,
    )
    assert.equal(code, 0)
    assert.equal((jsonOf(harnessed).report as Record<string, unknown>).name, '来自文件')

    harnessed.errors.length = 0
    assert.equal(
      await runCli(['report', 'create', '--definition', '@/tmp/missing.json'], harnessed.runtime),
      2,
    )
    assert.match(errorOf(harnessed), /指向的文件读不到：\/tmp\/missing.json/)
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('非法定义与未支持旋钮：退出码 1 且文案给出合法取值', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    const code = await runCli(
      ['report', 'data', '--definition', JSON.stringify({ name: 'x', interval: 'Hourly' })],
      harnessed.runtime,
    )
    assert.equal(code, 1)
    assert.match(
      errorOf(harnessed),
      /interval = "Hourly"，合法取值：Daily \/ Weekly \/ Monthly \/ Yearly/,
    )

    harnessed.errors.length = 0
    const budgeted = await runCli(
      ['report', 'data', '--definition', JSON.stringify({ name: 'x', balanceType: 'Budgeted' })],
      harnessed.runtime,
    )
    assert.equal(budgeted, 1)
    assert.match(errorOf(harnessed), /balanceType=Budgeted（预算口径）暂不支持/)
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('仪表盘族：读取现场、补丁式改组件、缺失目标显式报错', async () => {
  const fixture: FakeBudgetFixture = {
    ...FIXTURE,
    dashboardPages: [
      { id: 'page-1', name: 'Main', tombstone: 0 },
      { id: 'page-2', name: '年度', tombstone: 0 },
    ],
    dashboard: [
      {
        id: 'w-1',
        dashboard_page_id: 'page-1',
        type: 'custom-report',
        width: 4,
        height: 2,
        x: 0,
        y: 2,
        meta: '{"id":"rep-1"}',
        tombstone: 0,
      },
      {
        id: 'w-9',
        dashboard_page_id: 'page-1',
        type: 'ghost',
        width: 4,
        height: 2,
        x: 8,
        y: 8,
        tombstone: 1,
      },
    ],
  }
  const harnessed = await harness(fixture)
  try {
    assert.equal(await runCli(['dashboard', 'list'], harnessed.runtime), 0)
    const listed = jsonOf(harnessed)
    const pages = listed.pages as Record<string, unknown>[]
    assert.deepEqual(
      pages.map((page) => page.id),
      ['page-1', 'page-2'],
    )
    const widgets = (pages[0] as Record<string, unknown>).widgets as Record<string, unknown>[]
    assert.equal(widgets[0]?.reportName, '月度分类')
    assert.equal(widgets[0]?.missingReport, false)

    // 补丁语义：只给要改的字段，宽度沿用现值（12 列网格内）。
    harnessed.output.length = 0
    const patched = await runCli(
      ['dashboard', 'update-widget', '--widget', JSON.stringify({ id: 'w-1', width: 6 })],
      harnessed.runtime,
    )
    assert.equal(patched, 0)
    assert.deepEqual(jsonOf(harnessed).widget, {
      id: 'w-1',
      dashboard_page_id: 'page-1',
      type: 'custom-report',
      width: 6,
      height: 2,
      x: 0,
      y: 2,
      meta: { id: 'rep-1' },
    })

    harnessed.errors.length = 0
    assert.equal(
      await runCli(['dashboard', 'remove-widget', '--widget-id', 'w-404'], harnessed.runtime),
      1,
    )
    assert.match(errorOf(harnessed), /找不到仪表盘组件：widget-id = w-404/)

    harnessed.errors.length = 0
    assert.equal(
      await runCli(
        [
          'dashboard',
          'add-widget',
          '--page-id',
          'page-9',
          '--widget',
          '{"type":"summary-card","width":3,"height":2}',
        ],
        harnessed.runtime,
      ),
      1,
    )
    assert.match(errorOf(harnessed), /找不到仪表盘页面：page-id = page-9/)
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('帮助与表格输出', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    assert.equal(await runCli(['--help'], harnessed.runtime), 0)
    assert.match(harnessed.output.join('\n'), /用法：actual-reports <命令族> <动作>/)

    harnessed.output.length = 0
    const code = await runCli(
      ['report', 'data', '--report-id', 'rep-1', '--format', 'table'],
      harnessed.runtime,
    )
    assert.equal(code, 0)
    const text = harnessed.output.join('\n')
    assert.match(text, /【系列合计】/)
    assert.match(text, /【逐区间合计】/)
    assert.match(text, /100\.00/)
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

/** 本机 core 源码替身（写在临时目录里，走真实文件系统）。 */
const FAKE_MODEL = `export type SummaryWidget = AbstractWidget<
  'summary-card',
  { name?: string; content?: string } | null
>;
`

test('参考族：本地动作不加载官方 api、不打开预算', async () => {
  const harnessed = await harness(FIXTURE)
  const coreDir = join(harnessed.dataDir, 'core')
  try {
    await mkdir(join(coreDir, 'src', 'types', 'models'), { recursive: true })
    await writeFile(join(coreDir, 'src', 'types', 'models', 'dashboard.ts'), FAKE_MODEL)

    const code = await runCli(['reference', 'widgets', '--core-dir', coreDir], harnessed.runtime)
    assert.equal(code, 0, harnessed.errors.join('\n'))
    assert.deepEqual(harnessed.apiCalls, [], '本地动作不该下载/加载/同步预算')
    const payload = jsonOf(harnessed)
    assert.equal(payload.source, join(coreDir, 'src', 'types', 'models', 'dashboard.ts'))
    const types = payload.types as { type: string; fields: { name: string }[] }[]
    assert.deepEqual(
      types.map((item) => item.type),
      ['summary-card'],
    )
    assert.deepEqual(
      types[0]?.fields.map((item) => item.name),
      ['name', 'content'],
    )
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})

test('参考族：--help 与未知族文案都把参考族列出来', async () => {
  const harnessed = await harness(FIXTURE)
  try {
    assert.equal(await runCli(['--help'], harnessed.runtime), 0)
    assert.match(harnessed.output.join('\n'), /reference/)

    harnessed.errors.length = 0
    assert.equal(await runCli(['nope', 'list'], harnessed.runtime), 2)
    assert.match(errorOf(harnessed), /可用族：report \/ dashboard \/ reference/)
  } finally {
    await rm(harnessed.dataDir, { recursive: true, force: true })
  }
})
