/**
 * 用量统计设置页：概要卡 + 筛选栏（日期范围/provider/model）+ 按日柱状图 +
 * 按模型表（纯 CSS/SVG，无图表库）。历史数据由后台自动增量同步，页面只展示
 * 同步状态（进行中进度 / 最近完成时间 / 最近错误），无手动扫描按钮。
 * 响应式：≤767px 表格转纵向堆叠行（每格带标注）、柱状图标签抽稀、按钮 44px 热区。
 * @module usage-panel/client/section
 */
import { type ReactElement, useEffect, useMemo, useState } from 'react'
import {
  filterRows,
  normalizeCustomRange,
  type RangeKey,
  resolveRange,
  totalsByDay,
  totalsByModel,
} from '../ranges.ts'
import { fetchUsageData, type UsageData, type UsageWireRow } from './api.ts'
import { fmtCost, fmtTokens, todayLocal } from './format.ts'
import type { DictKey, Translate } from './i18n.ts'
import { DayChart, DayDetail, ModelTable } from './report.tsx'

export interface SectionProps {
  t: Translate
}

const RANGES: Array<{ key: RangeKey; labelKey: DictKey }> = [
  { key: '7d', labelKey: 'range7d' },
  { key: '30d', labelKey: 'range30d' },
  { key: 'month', labelKey: 'rangeMonth' },
  { key: 'all', labelKey: 'rangeAll' },
  { key: 'custom', labelKey: 'rangeCustom' },
]

interface Filters {
  range: RangeKey
  start: string
  end: string
  provider: string
  model: string
}

const INITIAL_FILTERS: Filters = {
  range: '7d',
  start: '',
  end: '',
  provider: '',
  model: '',
}

/** 同步状态行（进行中显示进度条，否则显示最近完成/错误）。 */
function SyncStatus(props: { data: UsageData; t: Translate }): ReactElement | null {
  const { data, t } = props
  const sync = data.sync
  if (!sync.running && sync.lastFinishedAt === null && sync.lastError === null) {
    return <p className="dup-meta">{t('syncIdle')}</p>
  }
  if (sync.running) {
    return (
      <div className="dup-progress" role="status" aria-label={t('syncRunning')}>
        <span className="dup-progressText">
          {t('syncRunning')}：{sync.done}/{sync.total}
        </span>
        <div className="dup-progressBar">
          <div
            className="dup-progressFill"
            style={{
              width: `${sync.total === 0 ? 0 : Math.round((sync.done / sync.total) * 100)}%`,
            }}
          />
        </div>
      </div>
    )
  }
  return (
    <p className="dup-meta">
      {t('syncDone')}：
      {sync.lastFinishedAt !== null ? new Date(sync.lastFinishedAt).toLocaleString() : '—'}
      {sync.lastError !== null ? ` · ${t('syncError')}：${sync.lastError}` : ''}
    </p>
  )
}

export function UsageSection(props: SectionProps): ReactElement {
  const { t } = props
  const [data, setData] = useState<UsageData | null>(null)
  const [failed, setFailed] = useState(false)
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

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

  // 同步进行中轮询（轻量：3s 间隔，仅在 running 时）；空闲时单次拉取。
  // biome-ignore lint/correctness/useExhaustiveDependencies: load 为闭包稳定函数，刻意不重建轮询定时器
  useEffect(() => {
    if (data?.sync.running !== true) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [data?.sync.running])

  const today = todayLocal()
  const scoped = useMemo(() => {
    if (data === null) return null
    const range =
      filters.range === 'custom'
        ? normalizeCustomRange(filters.start, filters.end)
        : resolveRange(filters.range, today)
    const rows = filterRows(data.rows, {
      range,
      provider: filters.provider,
      model: filters.model,
    })
    return {
      rows,
      days: totalsByDay(
        rows,
        filters.range,
        today,
        filters.range === 'custom' ? { start: filters.start, end: filters.end } : undefined,
      ),
      models: totalsByModel(rows),
    }
  }, [data, filters, today])

  const rangeCost = useMemo(() => {
    if (scoped === null) return null
    return scoped.rows.reduce((sum, row) => (row.cost === null ? sum : row.cost), 0)
  }, [scoped])

  const modelOptions = useMemo(() => {
    if (data === null) return []
    const seen = new Set<string>()
    for (const row of data.rows) seen.add(`${row.provider}\u0000${row.model}`)
    return [...seen]
      .map((key) => {
        const [provider, model] = key.split('\u0000')
        return { key, provider: provider ?? '', model: model ?? '' }
      })
      .sort((a, b) =>
        a.provider === b.provider
          ? a.model.localeCompare(b.model)
          : a.provider.localeCompare(b.provider),
      )
  }, [data])

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

  const scopedEmpty = scoped !== null && scoped.rows.length === 0 && data.rows.length > 0
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
        </div>
      </header>

      <SyncStatus data={data} t={t} />

      {data.rows.length === 0 ? (
        <p className="dup-empty">{t('noData')}</p>
      ) : (
        <>
          <div className="dup-filters">
            <div className="dup-ranges" role="tablist" aria-label={t('byDay')}>
              {RANGES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={filters.range === item.key}
                  className={`dup-rangeBtn${filters.range === item.key ? ' dup-rangeActive' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, range: item.key }))}
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
            {filters.range === 'custom' ? (
              <div className="dup-customRange">
                <input
                  type="date"
                  className="dup-input dup-in"
                  value={filters.start}
                  max={filters.end === '' ? undefined : filters.end}
                  aria-label={t('dateStart')}
                  onChange={(e) => setFilters((f) => ({ ...f, start: e.target.value }))}
                />
                <span className="dup-rangeDash">–</span>
                <input
                  type="date"
                  className="dup-input dup-in"
                  value={filters.end}
                  min={filters.start === '' ? undefined : filters.start}
                  aria-label={t('dateEnd')}
                  onChange={(e) => setFilters((f) => ({ ...f, end: e.target.value }))}
                />
              </div>
            ) : null}
            <div className="dup-filtersRow">
              <select
                className="dup-input dup-in"
                value={
                  filters.provider === ''
                    ? ''
                    : filters.model === ''
                      ? `p:${filters.provider}`
                      : `m:${filters.provider}\u0000${filters.model}`
                }
                aria-label={t('modelFilter')}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === '') {
                    setFilters((f) => ({ ...f, provider: '', model: '' }))
                    return
                  }
                  if (value.startsWith('p:')) {
                    setFilters((f) => ({ ...f, provider: value.slice(2), model: '' }))
                    return
                  }
                  const [provider, model] = value.slice(2).split('\u0000')
                  setFilters((f) => ({ ...f, provider: provider ?? '', model: model ?? '' }))
                }}
              >
                <option value="">{t('modelFilterAll')}</option>
                {modelOptions.map((option) => {
                  const value =
                    option.model === ''
                      ? `p:${option.provider}`
                      : `m:${option.provider}\u0000${option.model}`
                  return (
                    <option key={option.key} value={value}>
                      {option.model === ''
                        ? option.provider
                        : `${option.provider} / ${option.model}`}
                    </option>
                  )
                })}
              </select>
              <button
                type="button"
                className="dup-btn dup-btnGhost dup-btnSmall"
                onClick={() => setFilters(INITIAL_FILTERS)}
              >
                {t('filtersReset')}
              </button>
            </div>
          </div>

          {scopedEmpty ? <p className="dup-empty">{t('noMatch')}</p> : null}

          <div className="dup-stats">
            <div className="dup-stat">
              <span className="dup-statLabel">{t('total')}</span>
              <span className="dup-statValue">
                {fmtTokens(
                  scoped?.rows.reduce(
                    (sum, r) =>
                      sum + r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens,
                    0,
                  ) ?? 0,
                )}
              </span>
              <span className="dup-statMeta">
                {t('calls')}：{scoped?.rows.reduce((sum, r) => sum + r.calls, 0) ?? 0}
              </span>
            </div>
            <div className="dup-stat">
              <span className="dup-statLabel">{t('cost')}</span>
              <span className="dup-statValue">{fmtCost(rangeCost, data.currency)}</span>
              <span className="dup-statMeta">
                {data.pricedCount > 0 ? t('estimated') : t('priceHint')}
              </span>
            </div>
          </div>

          <h3 className="dup-groupTitle">{t('byDay')}</h3>
          <DayChart days={scoped?.days ?? []} selected={selectedDay} onSelect={setSelectedDay} />
          {selectedDay !== null && scoped !== null ? (
            <DayDetail
              date={selectedDay}
              rows={scoped.rows.filter((r: UsageWireRow) => r.date === selectedDay)}
              currency={data.currency}
              t={t}
            />
          ) : null}

          <h3 className="dup-groupTitle">{t('byModel')}</h3>
          <ModelTable rows={scoped?.rows ?? []} currency={data.currency} t={t} />
        </>
      )}
    </div>
  )
}
