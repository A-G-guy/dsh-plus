/**
 * 计时报告纯函数：资源分桶、bucket 汇总、报告组装、控制台格式化。
 * 只吃 plain data、零 DOM/Performance 依赖——浏览器采集在 client.ts，
 * 逻辑在此可被 node --test 直接验证。
 * @module @dsh-plus/web-boot-timing/report
 */

/** 资源计时条目的最小结构（浏览器 PerformanceResourceTiming 的子集）。 */
export interface ResourceSample {
  /** 资源 URL 的路径部分（已剥查询串与源）。 */
  readonly pathname: string
  /** 相对 timeOrigin 的开始毫秒。 */
  readonly startTime: number
  /** 相对 timeOrigin 的结束毫秒。 */
  readonly responseEnd: number
  /** 线上传输字节（含头，缓存命中为 0）。 */
  readonly transferSize: number
  /** 解码后主体字节（跨源无 TAO 时为 0）。 */
  readonly decodedBodySize: number
}

/** 资源分桶：与 dsh 引导瀑布的阶段一一对应。 */
export type ResourceBucket =
  | 'shellAssets' /** /assets/ 非字体非语言包：index/vendor JS+CSS 等外壳 */
  | 'langs' /** /assets/langs/*：按需语言包 */
  | 'fonts' /** /assets/fonts/*：KaTeX 等字体 */
  | 'pluginBundles' /** /plugins/* 组合包（排除 SSE 端点） */
  | 'eventStream' /** /plugins/events：SSE 长连接 */
  | 'rpc' /** /api*：RPC 单次往返（unary fetch） */
  | 'other' /** 其余同源与跨源条目 */

/** 五相时钟（全部相对 timeOrigin 的毫秒；缺席为 null）。 */
export interface PhaseMarks {
  readonly ttfbMs: number | null
  readonly indexDoneMs: number | null
  readonly domInteractiveMs: number | null
  readonly dclMs: number | null
  readonly loadMs: number | null
  readonly fcpMs: number | null
  readonly clientApplyMs: number | null
  readonly overlayRemovedMs: number | null
  readonly firstInputMs: number | null
}

/** 单桶汇总。 */
export interface BucketSummary {
  readonly count: number
  readonly firstStartMs: number | null
  readonly lastEndMs: number | null
  /** 线上字节合计（transferSize；缓存命中条目为 0）。 */
  readonly transferBytes: number
  /** 解码后字节合计（decodedBodySize）。 */
  readonly decodedBytes: number
}

/** 完整报告。 */
export interface BootReport {
  /** 报告生成时刻（Date.now()，跨报告排序用）。 */
  readonly generatedAt: number
  readonly phases: PhaseMarks
  readonly buckets: Readonly<Record<ResourceBucket, BucketSummary>>
  /** 资源条目总数（含 other）。 */
  readonly resourceCount: number
  /** 资源计时条目的 timeOrigin（与 generatedAt 对齐时刻）。 */
  readonly timeOrigin: number
}

/** 单个资源条目（其余字段在汇总时消费）。 */
export type ResourceBucketInput = ResourceSample

/**
 * 按 pathname 把资源归入引导瀑布桶。
 * 段边界严格：/assets 无尾斜杠、/assetsX 前缀、/pluginsX 前缀均落 other。
 * @param pathname - 已剥查询串的资源路径。
 */
export function classifyResource(pathname: string): ResourceBucket {
  if (pathname === '/plugins/events') return 'eventStream'
  if (pathname.startsWith('/assets/langs/')) return 'langs'
  if (pathname.startsWith('/assets/fonts/')) return 'fonts'
  if (pathname.startsWith('/assets/')) return 'shellAssets'
  if (pathname.startsWith('/plugins/')) return 'pluginBundles'
  if (pathname === '/api' || pathname.startsWith('/api/')) return 'rpc'
  return 'other'
}

/** 空桶（汇总起点）。 */
export function emptyBucket(): BucketSummary {
  return { count: 0, firstStartMs: null, lastEndMs: null, transferBytes: 0, decodedBytes: 0 }
}

/**
 * 汇总一组资源条目到全部桶（含空桶占位，报告形状稳定）。
 * @param resources - 资源采样（client 侧已从 PerformanceResourceTiming 投影）。
 */
export function summarizeBuckets(
  resources: readonly ResourceBucketInput[],
): Record<ResourceBucket, BucketSummary> {
  const buckets: Record<ResourceBucket, BucketSummary> = {
    shellAssets: emptyBucket(),
    langs: emptyBucket(),
    fonts: emptyBucket(),
    pluginBundles: emptyBucket(),
    eventStream: emptyBucket(),
    rpc: emptyBucket(),
    other: emptyBucket(),
  }
  for (const r of resources) {
    const key = classifyResource(r.pathname)
    const prev = buckets[key]
    const firstStart =
      prev.firstStartMs === null ? r.startTime : Math.min(prev.firstStartMs, r.startTime)
    const lastEnd =
      prev.lastEndMs === null ? r.responseEnd : Math.max(prev.lastEndMs, r.responseEnd)
    buckets[key] = {
      count: prev.count + 1,
      firstStartMs: firstStart,
      lastEndMs: lastEnd,
      transferBytes: prev.transferBytes + r.transferSize,
      decodedBytes: prev.decodedBytes + r.decodedBodySize,
    }
  }
  return buckets
}

/** 组装报告的输入（client 侧采集完的 plain data）。 */
export interface BuildReportInput {
  readonly generatedAt: number
  readonly timeOrigin: number
  readonly phases: PhaseMarks
  readonly resources: readonly ResourceSample[]
}

/**
 * 组装完整报告。
 * @param input - 已采集的时钟与资源采样。
 */
export function buildReport(input: BuildReportInput): BootReport {
  return {
    generatedAt: input.generatedAt,
    timeOrigin: input.timeOrigin,
    phases: input.phases,
    buckets: summarizeBuckets(input.resources),
    resourceCount: input.resources.length,
  }
}

/** 毫秒格式：整数 ms。 */
function fmtMs(value: number | null): string {
  return value === null ? '—' : `${String(Math.round(value))}ms`
}

/** 字节格式：B/KB/MB 三档。 */
export function fmtBytes(value: number): string {
  if (value <= 0) return '0B'
  if (value < 1024) return `${String(value)}B`
  if (value < 1024 * 1024) return `${String(Math.round(value / 102.4) / 10)}KB`
  return `${String(Math.round(value / 104857.6) / 10)}MB`
}

/** 一行桶摘要：`count 个 · span · 传输/解码`。 */
function fmtBucket(bucket: BucketSummary): string {
  if (bucket.count === 0) return '—'
  const span =
    bucket.firstStartMs === null || bucket.lastEndMs === null
      ? '—'
      : `${String(Math.round(bucket.firstStartMs))}→${String(Math.round(bucket.lastEndMs))}ms`
  return `${String(bucket.count)} 个 · ${span} · ${fmtBytes(bucket.transferBytes)}/${fmtBytes(bucket.decodedBytes)}`
}

/**
 * 控制台友好多行报告。
 * @param report - 待格式化的报告。
 */
export function formatReport(report: BootReport): string {
  const p = report.phases
  const overlayNote =
    p.overlayRemovedMs === null ? '未观测到（遮罩缺失或已被移除）' : fmtMs(p.overlayRemovedMs)
  return [
    `五相时钟   ttfb ${fmtMs(p.ttfbMs)} · index ${fmtMs(p.indexDoneMs)} · dcl ${fmtMs(p.dclMs)} · load ${fmtMs(p.loadMs)} · fcp ${fmtMs(p.fcpMs)}`,
    `UI 就绪    插件apply ${fmtMs(p.clientApplyMs)} · 遮罩移除 ${overlayNote} · 首次输入 ${fmtMs(p.firstInputMs)}`,
    `外壳资源   ${fmtBucket(report.buckets.shellAssets)}`,
    `插件组合包 ${fmtBucket(report.buckets.pluginBundles)}`,
    `语言包     ${fmtBucket(report.buckets.langs)} · 字体 ${fmtBucket(report.buckets.fonts)}`,
    `事件流     ${fmtBucket(report.buckets.eventStream)} · RPC ${fmtBucket(report.buckets.rpc)}`,
    `其余       ${fmtBucket(report.buckets.other)}（共 ${String(report.resourceCount)} 条）`,
  ].join('\n')
}
