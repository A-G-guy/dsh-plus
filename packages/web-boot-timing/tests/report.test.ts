/**
 * 计时报告纯函数测试：Given-When-Then，覆盖分桶段边界、汇总数学、
 * 报告形状与格式化的验收条件。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildReport,
  classifyResource,
  emptyBucket,
  fmtBytes,
  formatReport,
  type ResourceSample,
  summarizeBuckets,
} from '../src/report.ts'

test('给定路径段边界用例，当分桶时，则仅严格前缀命中对应桶', () => {
  assert.equal(classifyResource('/assets/index-x.js'), 'shellAssets')
  assert.equal(classifyResource('/assets/langs/zh.json'), 'langs')
  assert.equal(classifyResource('/assets/fonts/a.woff2'), 'fonts')
  assert.equal(classifyResource('/plugins/??a,b&rev=1'), 'pluginBundles')
  assert.equal(classifyResource('/plugins/events'), 'eventStream')
  assert.equal(classifyResource('/api'), 'rpc')
  assert.equal(classifyResource('/api/remote.mux'), 'rpc')
  // 段边界与近似前缀必须落 other
  assert.equal(classifyResource('/assets'), 'other')
  assert.equal(classifyResource('/assetsX/a.js'), 'other')
  assert.equal(classifyResource('/pluginsX/a.js'), 'other')
  assert.equal(classifyResource('/apiary/x'), 'other')
  assert.equal(classifyResource('/favicon.svg'), 'other')
})

function sample(overrides: Partial<ResourceSample> & { pathname: string }): ResourceSample {
  return {
    startTime: 0,
    responseEnd: 1,
    transferSize: 0,
    decodedBodySize: 0,
    ...overrides,
  }
}

test('给定跨桶资源样本，当汇总时，则各桶计数/跨度/字节各自正确', () => {
  const buckets = summarizeBuckets([
    sample({
      pathname: '/assets/index-a.js',
      startTime: 100,
      responseEnd: 400,
      transferSize: 300,
      decodedBodySize: 900,
    }),
    sample({
      pathname: '/assets/style.css',
      startTime: 150,
      responseEnd: 350,
      transferSize: 100,
      decodedBodySize: 400,
    }),
    sample({
      pathname: '/plugins/??a',
      startTime: 500,
      responseEnd: 900,
      transferSize: 1000,
      decodedBodySize: 3000,
    }),
    sample({
      pathname: '/api/remote.mux',
      startTime: 950,
      responseEnd: 2000,
      transferSize: 50,
      decodedBodySize: 50,
    }),
  ])
  assert.deepEqual(buckets.shellAssets, {
    count: 2,
    firstStartMs: 100,
    lastEndMs: 400,
    transferBytes: 400,
    decodedBytes: 1300,
  })
  assert.deepEqual(buckets.pluginBundles, {
    count: 1,
    firstStartMs: 500,
    lastEndMs: 900,
    transferBytes: 1000,
    decodedBytes: 3000,
  })
  assert.equal(buckets.rpc.count, 1)
  // 空桶保持稳定形状（报告消费方不需判 undefined）
  assert.deepEqual(buckets.fonts, emptyBucket())
  assert.deepEqual(buckets.other, emptyBucket())
})

test('给定空资源集，当汇总时，则全桶为空且不抛出', () => {
  const buckets = summarizeBuckets([])
  for (const key of [
    'shellAssets',
    'langs',
    'fonts',
    'pluginBundles',
    'eventStream',
    'rpc',
    'other',
  ] as const) {
    assert.deepEqual(buckets[key], emptyBucket(), key)
  }
})

test('给定采集输入，当组装报告时，则计数与时钟原样落位', () => {
  const report = buildReport({
    generatedAt: 1_700_000_000_000,
    timeOrigin: 1_699_999_990_000,
    phases: {
      ttfbMs: 200,
      indexDoneMs: 350,
      domInteractiveMs: 400,
      dclMs: 420,
      loadMs: 900,
      fcpMs: 450,
      clientApplyMs: 700,
      overlayRemovedMs: 950,
      firstInputMs: null,
    },
    resources: [sample({ pathname: '/assets/a.js', transferSize: 10 })],
  })
  assert.equal(report.generatedAt, 1_700_000_000_000)
  assert.equal(report.timeOrigin, 1_699_999_990_000)
  assert.equal(report.resourceCount, 1)
  assert.equal(report.phases.overlayRemovedMs, 950)
  assert.equal(report.buckets.shellAssets.count, 1)
})

test('给定含缺席时钟的报告，当格式化时，则用占位符且不抛出', () => {
  const report = buildReport({
    generatedAt: 0,
    timeOrigin: 0,
    phases: {
      ttfbMs: null,
      indexDoneMs: null,
      domInteractiveMs: null,
      dclMs: null,
      loadMs: null,
      fcpMs: null,
      clientApplyMs: null,
      overlayRemovedMs: null,
      firstInputMs: null,
    },
    resources: [],
  })
  const text = formatReport(report)
  assert.match(text, /五相时钟/)
  assert.match(text, /ttfb —/)
  assert.match(text, /未观测到/)
  assert.match(text, /共 0 条/)
})

test('给定字节数，当格式化时，则按 B/KB/MB 三档取整', () => {
  assert.equal(fmtBytes(0), '0B')
  assert.equal(fmtBytes(512), '512B')
  assert.equal(fmtBytes(1536), '1.5KB')
  assert.equal(fmtBytes(2 * 1024 * 1024), '2MB')
})
