/**
 * 用量统计设置页：概要卡 + 按日柱状图 + 按模型表（纯 CSS/SVG，无图表库）。
 * 注册进 settings.section 官方插槽（设置导航独立页）。
 * 响应式：≤767px 表格转纵向堆叠行、柱状图标签抽稀、按钮 44px 热区。
 * @module usage-panel/client/section
 */
import { type ReactElement, useEffect, useMemo, useState } from 'react'
import { type RangeKey, rangeDays, totalsByDay, totalsByModel } from '../ranges.ts'
import { fetchUsageData, startScan, type UsageData, type UsageWireRow } from './api.ts'

export interface SectionProps {
  t(key: string): string
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtCost(cost: number | null, currency: string): string {
  if (cost === null) return '—'
  const abs = Math.abs(cost)
  return `${cost.toFixed(abs > 0 && abs < 0.01 ? 4 : 2)} ${currency}`
}

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

const RANGES: Array<{ key: RangeKey; labelKey: string }> = [
  { key: '7d', labelKey: 'range7d' },
  { key: '30d', labelKey: 'range30d' },
  { key: 'month', labelKey: 'rangeMonth' },
  { key: 'all', labelKey: 'rangeAll' },
]

export function UsageSection(props: SectionProps): ReactElement {
  const { t } = props
  const [data, setData] = useState<UsageData | null>(null)
  const [failed, setFailed] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [range, setRange] = useState<RangeKey>('7d')

  const load = (): void => {
    fetchUsageData()
      .then((loaded) => {
        setData(loaded)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load 是本组件闭包稳定函数（读端点后 setState），无需入依赖
  useEffect(() => {
    load()
  }, [])

  // 扫描进行中轮询（轻量：3s 间隔，仅在 scanning 非 null 时）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: load 为闭包稳定函数，刻意不重建轮询定时器
  useEffect(() => {
    if (data?.scanning == null) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [data?.scanning])

  const today = todayLocal()
  const scoped = useMemo(() => {
    if (data === null) return null
    const rangeSpec = rangeDays(range, today)
    const rows =
      rangeSpec === null
        ? data.rows
        : data.rows.filter((r) => r.date >= rangeSpec.start && r.date <= rangeSpec.end)
    return { rows, days: totalsByDay(rows, range, today), models: totalsByModel(rows) }
  }, [data, range, today])

  const rangeCost = useMemo(() => {
    if (scoped === null) return null
    return scoped.rows.reduce((sum, row) => (row.cost === null ? sum : sum + row.cost), 0)
  }, [scoped])

  const onScan = (): void => {
    setScanning(true)
    startScan()
      .then(() => load())
      .catch(() => {})
      .finally(() => setScanning(false))
  }

  if (data === null) {
    return (
      <div className="dup-section">
        <p className="dup-empty">{failed ? `${t('loadFailed')}` : t('loading')}</p>
        {failed ? (
          <button type="button" className="dup-btn dup-btnGhost" onClick={load}>
            {t('retry')}
          </button>
        ) : null}
      </div>
    )
  }

  const scanState = data.scanning
  return (
    <div className="dup-section">
      <header className="dup-head">
        <div className="dup-headText">
          <h2 className="dup-title">{t('title')}</h2>
          <p className="dup-desc">{t('description')}</p>
        </div>
        <div className="dup-headActions">
          <span className="dup-meta">
            {t('sessions')}：{data.sessions}
          </span>
          <button
            type="button"
            className="dup-btn dup-btnGhost"
            disabled={scanState !== null || scanning}
            onClick={onScan}
          >
            {scanState !== null || scanning ? t('scanRunning') : t('scanHistory')}
          </button>
        </div>
      </header>

      {scanState !== null ? (
        <div
          className="dup-progress"
          role="status"
          aria-label={`${t('scanProgress')} ${scanState.done}/${scanState.total}`}
        >
          <span className="dup-progressText">
            {t('scanProgress')}：{scanState.done}/{scanState.total}
          </span>
          <div className="dup-progressBar">
            <div
              className="dup-progressFill"
              style={{
                width: `${scanState.total === 0 ? 0 : Math.round((scanState.done / scanState.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {scoped === null || (scoped.rows.length === 0 && data.rows.length === 0) ? (
        <p className="dup-empty">{t('noData')}</p>
      ) : (
        <>
          <div className="dup-ranges" role="tablist" aria-label={t('byDay')}>
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={range === item.key}
                className={`dup-rangeBtn${range === item.key ? ' dup-rangeActive' : ''}`}
                onClick={() => setRange(item.key)}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>

          <div className="dup-cards">
            <div className="dup-card">
              <span className="dup-cardLabel">{t('total')}</span>
              <span className="dup-cardValue">
                {fmtTokens(
                  scoped?.rows.reduce(
                    (sum, r) =>
                      sum + r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens,
                    0,
                  ) ?? 0,
                )}
              </span>
              <span className="dup-cardMeta">
                {t('calls')}：{scoped?.rows.reduce((sum, r) => sum + r.calls, 0) ?? 0}
              </span>
            </div>
            <div className="dup-card">
              <span className="dup-cardLabel">{t('cost')}</span>
              <span className="dup-cardValue">{fmtCost(rangeCost, data.currency)}</span>
              <span className="dup-cardMeta">
                {data.pricedCount > 0 ? t('estimated') : t('priceHint')}
              </span>
            </div>
          </div>

          <h3 className="dup-groupTitle">{t('byDay')}</h3>
          <DayChart days={scoped?.days ?? []} />

          <h3 className="dup-groupTitle">{t('byModel')}</h3>
          <ModelTable rows={scoped?.rows ?? []} currency={data.currency} t={t} />
        </>
      )}
    </div>
  )
}

function DayChart(props: {
  days: Array<{
    date: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }>
}): ReactElement {
  const days = props.days
  const max = Math.max(
    1,
    ...days.map((d) => d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheWriteTokens),
  )
  // 窄屏标签抽稀：>10 根柱时隔 N 根显示标签。
  const labelStep = Math.ceil(days.length / 10)
  return (
    <div className="dup-chart" role="img" aria-label="daily usage bars">
      {days.map((day, index) => {
        const total =
          day.inputTokens + day.outputTokens + day.cacheReadTokens + day.cacheWriteTokens
        return (
          <div key={day.date} className="dup-barCol" title={`${day.date}：${fmtTokens(total)}`}>
            <div
              className="dup-bar"
              style={{ height: `${Math.max(total > 0 ? 3 : 0, Math.round((total / max) * 100))}%` }}
            />
            <span className="dup-barLabel">{index % labelStep === 0 ? day.date.slice(5) : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function ModelTable(props: {
  rows: UsageWireRow[]
  currency: string
  t(key: string): string
}): ReactElement {
  const { rows, currency, t } = props
  const merged = totalsByModel(rows)
  const costByKey = new Map(rows.map((r) => [`${r.provider}\u0000${r.model}`, r.cost] as const))
  return (
    <div className="dup-table">
      <div className="dup-tr dup-th">
        <span className="dup-td dup-tdModel">
          {t('provider')} / {t('model')}
        </span>
        <span className="dup-td">{t('inputTokens')}</span>
        <span className="dup-td">{t('outputTokens')}</span>
        <span className="dup-td">{t('cacheRead')}</span>
        <span className="dup-td">{t('calls')}</span>
        <span className="dup-td">{t('cost')}</span>
      </div>
      {merged.map((m) => {
        const cost = costByKey.get(`${m.provider}\u0000${m.model}`) ?? null
        const hasAnyCost = rows.some(
          (r) => r.provider === m.provider && r.model === m.model && r.cost !== null,
        )
        return (
          <div className="dup-tr" key={`${m.provider}/${m.model}`}>
            <span className="dup-td dup-tdModel">
              <span className="dup-provider">{m.provider}</span>
              <span className="dup-model">{m.model}</span>
            </span>
            <span className="dup-td">{fmtTokens(m.inputTokens)}</span>
            <span className="dup-td">{fmtTokens(m.outputTokens)}</span>
            <span className="dup-td">{fmtTokens(m.cacheReadTokens)}</span>
            <span className="dup-td">{m.calls}</span>
            <span className="dup-td">{hasAnyCost ? fmtCost(cost, currency) : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}
