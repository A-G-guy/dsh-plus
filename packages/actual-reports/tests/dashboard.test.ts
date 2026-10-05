/**
 * 仪表盘族的行为测试：现场读取、补丁式写入、官方自动排版与显式错误。
 *
 * 替身按官方实现（本机 API 的 app methods）复刻了同样的语义，因此这里断言的是
 * 「我们怎么调、怎么读回」，不是替身自身的行为。
 * @module @dsh-plus/actual-reports/tests/dashboard
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ActionContext } from '../src/action.ts'
import { runDashboardAction } from '../src/dashboard-commands.ts'
import { buildWidgetRow } from '../src/dashboard-store.ts'
import { type FakeBudgetFixture, fakeBudget } from './fixtures/fake-budget.ts'

/** 基准现场：一页两个组件（一个是报表组件，一个是失效引用）。 */
const FIXTURE: FakeBudgetFixture = {
  reports: [{ id: 'rep-1', name: '月度分类' }],
  dashboardPages: [{ id: 'page-1', name: 'Main', tombstone: 0 }],
  dashboard: [
    {
      id: 'w-1',
      dashboard_page_id: 'page-1',
      type: 'custom-report',
      width: 4,
      height: 2,
      x: 0,
      y: 0,
      meta: '{"id":"rep-1"}',
      tombstone: 0,
    },
    {
      id: 'w-2',
      dashboard_page_id: 'page-1',
      type: 'custom-report',
      width: 4,
      height: 2,
      x: 4,
      y: 0,
      meta: '{"id":"rep-gone"}',
      tombstone: 0,
    },
  ],
}

/** 造一个动作上下文。 */
function contextOf(
  fixture: FakeBudgetFixture,
  flags: ActionContext['flags'] = {},
): {
  context: ActionContext
  calls: { name: string; args: unknown }[]
} {
  const fake = fakeBudget(fixture)
  return {
    context: {
      access: { api: fake.api, call: fake.call },
      flags,
      format: 'json',
      today: '2025-03-15',
    },
    calls: fake.calls,
  }
}

/** 取载荷（收窄成可索引对象）。 */
function payloadOf(result: { payload: unknown }): Record<string, unknown> {
  return result.payload as Record<string, unknown>
}

test('list：解析报表引用并标注失效引用', async () => {
  const { context } = contextOf(FIXTURE)
  const result = await runDashboardAction('list', context)
  const pages = payloadOf(result).pages as Record<string, unknown>[]
  const widgets = pages[0]?.widgets as Record<string, unknown>[]
  assert.deepEqual(
    widgets.map((widget) => [widget.id, widget.reportName, widget.missingReport]),
    [
      ['w-1', '月度分类', false],
      ['w-2', null, true],
    ],
  )
  assert.match(result.text, /报表「月度分类」/)
  assert.match(result.text, /引用已失效/)
})

test('add-widget：省略 x/y 时走官方自动排版，并读回新建的组件', async () => {
  const { context } = contextOf(FIXTURE, {
    pageId: 'page-1',
    widget: JSON.stringify({
      type: 'add-widget-card',
      width: 4,
      height: 2,
      meta: { content: 'hi' },
    }),
  })
  const result = await runDashboardAction('add-widget', context)
  const widget = payloadOf(result).widget as Record<string, unknown>
  // 官方排版：最后一个组件在 x=4 宽 4，下一个 4+4+4=12 未越界 → x=8,y=0。
  assert.deepEqual(
    [widget.id, widget.type, widget.x, widget.y, widget.width, widget.height],
    ['widget-new-1', 'add-widget-card', 8, 0, 4, 2],
  )
  assert.deepEqual(widget.meta, { content: 'hi' })
  assert.match(result.text, /新建组件/)
})

test('add-widget：显式坐标原样透传，只给一个坐标时显式报错', async () => {
  const explicit = contextOf(FIXTURE, {
    pageId: 'page-1',
    widget: JSON.stringify({ type: 'summary-card', width: 3, height: 2, x: 0, y: 1 }),
  })
  const result = await runDashboardAction('add-widget', explicit.context)
  const widget = payloadOf(result).widget as Record<string, unknown>
  assert.deepEqual([widget.x, widget.y], [0, 1])

  const half = contextOf(FIXTURE, {
    pageId: 'page-1',
    widget: JSON.stringify({ type: 'summary-card', width: 3, height: 2, x: 0 }),
  })
  await assert.rejects(
    async () => await runDashboardAction('add-widget', half.context),
    /x\/y 要么都省略/,
  )
})

test('update-widget：补丁语义只改给定字段，未知组件显式报错', async () => {
  const { context, calls } = contextOf(FIXTURE, {
    widget: JSON.stringify({ id: 'w-1', width: 6, meta: { id: 'rep-1', note: 'x' } }),
  })
  const result = await runDashboardAction('update-widget', context)
  const widget = payloadOf(result).widget as Record<string, unknown>
  assert.deepEqual([widget.width, widget.height, widget.x, widget.y], [6, 2, 0, 0])
  assert.deepEqual(widget.meta, { id: 'rep-1', note: 'x' })
  assert.deepEqual(
    calls.map((call) => call.name).filter((name) => name.startsWith('dashboard-')),
    ['dashboard-update-widget'],
  )

  const missing = contextOf(FIXTURE, { widget: JSON.stringify({ id: 'w-404', width: 6 }) })
  await assert.rejects(
    async () => await runDashboardAction('update-widget', missing.context),
    /找不到仪表盘组件：widget-id = w-404/,
  )

  const noId = contextOf(FIXTURE, { widget: JSON.stringify({ width: 6 }) })
  await assert.rejects(
    async () => await runDashboardAction('update-widget', noId.context),
    /修改组件需要已存组件的 id/,
  )
})

test('layout：只改几何字段，多给字段或未知 id 都报错', async () => {
  const { context, calls } = contextOf(FIXTURE, {
    pageId: 'page-1',
    layout: JSON.stringify([{ id: 'w-1', x: 4, y: 2, width: 8 }]),
  })
  const result = await runDashboardAction('layout', context)
  // 下发的是几何补丁，不带 meta/type：官方 update() 是逐字段写，带上会绕过 schema 转换。
  const sent = calls.find((call) => call.name === 'dashboard-update')?.args as Record<
    string,
    unknown
  >[]
  assert.deepEqual(sent, [{ id: 'w-1', x: 4, y: 2, width: 8, height: 2 }])
  const widgets = payloadOf(result).widgets as Record<string, unknown>[]
  const moved = widgets.find((widget) => widget.id === 'w-1')
  assert.deepEqual([moved?.x, moved?.y, moved?.width, moved?.height], [4, 2, 8, 2])

  const extra = contextOf(FIXTURE, {
    pageId: 'page-1',
    layout: JSON.stringify([{ id: 'w-1', x: 0, type: 'summary-card' }]),
  })
  await assert.rejects(
    async () => await runDashboardAction('layout', extra.context),
    /只接受 id\/x\/y\/width\/height/,
  )

  const unknown = contextOf(FIXTURE, {
    pageId: 'page-1',
    layout: JSON.stringify([{ id: 'w-404', x: 0 }]),
  })
  await assert.rejects(
    async () => await runDashboardAction('layout', unknown.context),
    /找不到仪表盘组件：widget-id = w-404/,
  )
})

test('copy-widget：复制到目标页并读回新组件；目标页不存在时报错', async () => {
  const fixture: FakeBudgetFixture = {
    ...FIXTURE,
    dashboardPages: [
      { id: 'page-1', name: 'Main', tombstone: 0 },
      { id: 'page-2', name: '年度', tombstone: 0 },
    ],
  }
  const { context } = contextOf(fixture, { widgetId: 'w-1', targetPageId: 'page-2' })
  const result = await runDashboardAction('copy-widget', context)
  const payload = payloadOf(result)
  assert.equal(payload.targetPageId, 'page-2')
  const copied = payload.widget as Record<string, unknown>
  assert.equal(copied.dashboard_page_id, 'page-2')
  assert.equal(copied.type, 'custom-report')
  assert.deepEqual(copied.meta, { id: 'rep-1' })

  const wrongPage = contextOf(fixture, { widgetId: 'w-1', targetPageId: 'page-9' })
  await assert.rejects(
    async () => await runDashboardAction('copy-widget', wrongPage.context),
    /找不到仪表盘页面：page-id = page-9/,
  )
})

test('remove-widget / reset / create / rename / delete 的现场语义', async () => {
  const removed = contextOf(FIXTURE, { widgetId: 'w-1' })
  const removedResult = await runDashboardAction('remove-widget', removed.context)
  assert.equal((payloadOf(removedResult).removed as Record<string, unknown>).type, 'custom-report')

  const reset = contextOf(FIXTURE, { pageId: 'page-1' })
  const resetResult = await runDashboardAction('reset', reset.context)
  // 官方 reset 是「恢复默认组件集」，不是清空：替身放了一个最小默认组件。
  assert.deepEqual(
    (payloadOf(resetResult).widgets as Record<string, unknown>[]).map((widget) => widget.type),
    ['net-worth-card'],
  )

  const created = contextOf(FIXTURE, { name: '年度' })
  const createdResult = await runDashboardAction('create', created.context)
  assert.equal((payloadOf(createdResult).page as Record<string, unknown>).name, '年度')

  const renamed = contextOf(FIXTURE, { pageId: 'page-1', name: '总览' })
  const renamedResult = await runDashboardAction('rename', renamed.context)
  assert.equal((payloadOf(renamedResult).page as Record<string, unknown>).name, '总览')

  // 两页时删页会连带删掉该页组件；只剩一页时官方会拒绝（错误原样上抛）。
  const twoPages: FakeBudgetFixture = {
    ...FIXTURE,
    dashboardPages: [
      { id: 'page-1', name: 'Main', tombstone: 0 },
      { id: 'page-2', name: '年度', tombstone: 0 },
    ],
  }
  const deleted = contextOf(twoPages, { pageId: 'page-1' })
  const deletedResult = await runDashboardAction('delete', deleted.context)
  assert.equal(payloadOf(deletedResult).removedWidgets, 2)
  assert.deepEqual(
    (payloadOf(deletedResult).pages as Record<string, unknown>[]).map((page) => page.id),
    ['page-2'],
  )

  const lastPage = contextOf(FIXTURE, { pageId: 'page-1' })
  await assert.rejects(
    async () => await runDashboardAction('delete', lastPage.context),
    /Cannot delete the last dashboard page/,
  )
})

test('组件写入门槛：未知字段、宽度越界、meta 非对象都显式报错', () => {
  const base = {
    id: 'w-1',
    dashboard_page_id: 'page-1',
    type: 'custom-report',
    width: 4,
    height: 2,
    x: 0,
    y: 0,
  }
  assert.throws(
    () => buildWidgetRow({ id: 'w-1', nope: 1 }, { base, requireId: true }),
    /不是可写字段/,
  )
  assert.throws(
    () => buildWidgetRow({ id: 'w-1', width: 13 }, { base, requireId: true }),
    /width 不能大于 12/,
  )
  assert.throws(
    () => buildWidgetRow({ id: 'w-1', x: 12 }, { base, requireId: true }),
    /x 不能大于 11/,
  )
  assert.throws(
    () => buildWidgetRow({ id: 'w-1', meta: 'text' }, { base, requireId: true }),
    /meta 需要 JSON 对象/,
  )
  assert.throws(() => buildWidgetRow({ width: 4 }, { pageId: 'page-1' }), /type 缺失/)
  assert.throws(
    () => buildWidgetRow({ type: 'summary-card', width: 4 }, { pageId: 'page-1' }),
    /height 需要整数/,
  )
})
