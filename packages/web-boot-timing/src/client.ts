/**
 * 浏览器半：五相计时观测（纯读侧，零 DOM 注入、零请求改写）。
 *
 * 采集面（全部来自标准 Performance API + 两个一次性事件监听）：
 * - 导航时钟：ttfb / index 传输完成 / domInteractive / DCL / load / FCP；
 * - 本插件 apply 时刻（≈ 插件全量加载完成点，boot 遮罩仍在）；
 * - 遮罩移除时刻：MutationObserver 盯 `[data-dsh-boot]` 消失 = UI 挂载完成；
 * - 首次输入时刻：pointerdown/keydown 一次性监听 = 真正可操作；
 * - 资源分桶：PerformanceResourceTiming 按 pathname 归入外壳/组合包/字体/
 *   语言包/事件流/RPC 桶（report.ts 纯函数）。
 *
 * 输出（报告 = 采集完成的 plain data，经 report.ts 组装）：
 * - console.info（人读多行报告）；
 * - globalThis.__DSH_PLUS_WEB_BOOT_TIMING_REPORT__（机读钩子）；
 * - localStorage 历史最近 10 次（优化前后对比）。
 *
 * 安全边界：任何采集/输出异常被 try/catch 隔离并带上下文 warn——观测插件
 * 自身故障绝不影响 boot 或 UI。ctx.effect 兜底清理监听器与定时器。
 * 构建产物须为 window.__ModuleLoader__.load({id, factory}) 形式
 * （包装见 tsdown.config.ts 的 banner/footer）。
 * @module @dsh-plus/web-boot-timing/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { TIMING_GLOBAL_KEY } from './ns.ts'
import {
  type BootReport,
  buildReport,
  formatReport,
  type PhaseMarks,
  type ResourceSample,
} from './report.ts'

export const name = 'dsh-plus-web-boot-timing'

/** 注入的配置行形状（node 半保证 JSON 可序列化）。 */
interface TimingGlobal {
  readonly enabled?: boolean
  readonly settleMs?: number
}

/** 钩子：`globalThis.__DSH_PLUS_WEB_BOOT_TIMING_REPORT__` 机读最新报告。 */
export const REPORT_GLOBAL_KEY = '__DSH_PLUS_WEB_BOOT_TIMING_REPORT__'
/** localStorage 历史键（仅本插件读写）。 */
export const HISTORY_STORAGE_KEY = 'dsh-plus-web-boot-timing/history'
/** 历史条数上限（旧报告淘汰）。 */
const HISTORY_LIMIT = 10

/** 读注入配置；行缺席或未启用返回 undefined（浏览器半零行为）。 */
function readGlobal(): TimingGlobal | undefined {
  const flag: unknown = Reflect.get(globalThis, TIMING_GLOBAL_KEY)
  if (typeof flag !== 'object' || flag === null) return undefined
  const cfg = flag as TimingGlobal
  return cfg.enabled === true ? cfg : undefined
}

/** 剥源与查询串取 pathname（资源名可能是完整 URL）。 */
function pathnameOf(name: string): string {
  try {
    return new URL(name, window.location.href).pathname
  } catch {
    return name
  }
}

/** 采集导航与绘制时钟（字段缺失一律 null，绝不抛出）。 */
function collectPhases(clientApplyMs: number, overlayRemovedMs: number | null): PhaseMarks {
  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  const fcp = performance
    .getEntriesByType('paint')
    .find((entry) => entry.name === 'first-contentful-paint')
  return {
    ttfbMs: nav?.responseStart ?? null,
    indexDoneMs: nav?.responseEnd ?? null,
    domInteractiveMs: nav?.domInteractive ?? null,
    dclMs: nav?.domContentLoadedEventEnd ?? null,
    loadMs: nav?.loadEventEnd ?? null,
    fcpMs: fcp?.startTime ?? null,
    clientApplyMs: Number.isFinite(clientApplyMs) ? clientApplyMs : null,
    overlayRemovedMs,
    firstInputMs: null, // 首次输入在结算时回填（见 emit）
  }
}

/** 投影资源计时条目（跨源无 TAO 的字节为 0，如实汇总）。 */
function collectResources(): ResourceSample[] {
  return performance.getEntriesByType('resource').map((entry) => {
    const r = entry as PerformanceResourceTiming
    return {
      pathname: pathnameOf(r.name),
      startTime: r.startTime,
      responseEnd: r.responseEnd,
      transferSize: r.transferSize ?? 0,
      decodedBodySize: r.decodedBodySize ?? 0,
    }
  })
}

/** 遮罩与首次输入监听的可清理状态。 */
interface Watchers {
  /** 遮罩移除时刻（未观测到为 null）。 */
  overlayRemovedMs: () => number | null
  /** 首次输入时刻（未发生为 null）。 */
  firstInputMs: () => number | null
  stop: () => void
}

/** 启动遮罩消失 + 首次输入两个一次性观测（apply 时遮罩应仍在）。 */
function startWatchers(): Watchers {
  let overlayRemovedMs: number | null = null
  let firstInputMs: number | null = null
  const overlay = document.querySelector('[data-dsh-boot]')
  let observer: MutationObserver | undefined
  if (overlay !== null) {
    observer = new MutationObserver(() => {
      if (document.querySelector('[data-dsh-boot]') === null) {
        overlayRemovedMs = performance.now()
        observer?.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }
  const onInput = (): void => {
    if (firstInputMs === null) firstInputMs = performance.now()
  }
  // capture + once：只记第一下，不干预默认行为（监听器不含 preventDefault）。
  const opts = { capture: true, passive: true, once: true } as const
  document.addEventListener('pointerdown', onInput, opts)
  document.addEventListener('keydown', onInput, opts)
  return {
    overlayRemovedMs: () => overlayRemovedMs,
    firstInputMs: () => firstInputMs,
    stop: () => {
      observer?.disconnect()
      document.removeEventListener('pointerdown', onInput, opts)
      document.removeEventListener('keydown', onInput, opts)
    },
  }
}

/** 追加 localStorage 历史（cap 10；存储异常带上下文 warn，不影响其余输出）。 */
function pushHistory(report: BootReport): void {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    const history: BootReport[] = Array.isArray(parsed) ? parsed : []
    history.unshift(report)
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(0, HISTORY_LIMIT)),
    )
  } catch (error) {
    console.warn(
      '[web-boot-timing] localStorage 历史写入失败（报告仍已输出到 console/钩子）',
      error,
    )
  }
}

/** 生成并分发一份报告（console + 全局钩子 + 历史；单次输出）。 */
function emit(clientApplyMs: number, watchers: Watchers, settleMs: number): void {
  try {
    const phases = collectPhases(clientApplyMs, watchers.overlayRemovedMs())
    const report = buildReport({
      generatedAt: Date.now(),
      timeOrigin: performance.timeOrigin,
      // 结算点回填首次输入（结算前已发生才计；之后的首次输入不追补——报告是一次性快照）。
      phases: { ...phases, firstInputMs: watchers.firstInputMs() },
      resources: collectResources(),
    })
    Reflect.set(globalThis, REPORT_GLOBAL_KEY, report)
    console.info(
      `[web-boot-timing] settle=${String(settleMs)}ms 报告（globalThis.${REPORT_GLOBAL_KEY} 可读）\n${formatReport(report)}`,
    )
    pushHistory(report)
  } catch (error) {
    console.warn('[web-boot-timing] 报告生成失败（观测故障不影响 boot）', error)
  }
}

export function apply(ctx: Context): void {
  const cfg = readGlobal()
  if (cfg === undefined) return // 配置行缺席 = 插件禁用/宿主无 webServer：零行为

  const applyMs = performance.now()
  const watchers = startWatchers()
  const settleMs = cfg.settleMs ?? 1500
  let timer: number | undefined
  let emitted = false
  const emitOnce = (): void => {
    if (emitted) return
    emitted = true
    emit(applyMs, watchers, settleMs)
  }
  const schedule = (): void => {
    timer = window.setTimeout(emitOnce, settleMs)
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })

  ctx.effect(
    () => () => {
      emitted = true // dispose 后抑制迟到的定时器
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('load', schedule)
      watchers.stop()
    },
    'web-boot-timing: cleanup watchers & timer',
  )
}
