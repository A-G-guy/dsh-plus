/**
 * 报表展示组件：按日柱状图 / 单日明细 / 按模型表。
 * 全表列均带表头与移动端 data-label 标注（tokens 计数附带 token 单位说明）。
 * @module usage-panel/client/report
 */
import type { ReactElement } from 'react'
import { type DayTotal, type ModelTotal, totalsByModel } from '../ranges.ts'
import type { UsageWireRow } from './api.ts'
import { fmtCost, fmtTokens } from './format.ts'

export interface ReportTextProps {
  t(key: string): string
}

/** 按日柱状图（纯 CSS，点击展开单日明细）。 */
export function DayChart(props: {
  days: DayTotal[]
  selected: string | null
  onSelect(date: string | null): void
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
        const active = props.selected === day.date
        return (
          <button
            key={day.date}
            type="button"
            className={`dup-barCol${active ? ' dup-barActive' : ''}`}
            title={`${day.date}：${fmtTokens(total)}`}
            aria-pressed={active}
            onClick={() => props.onSelect(active ? null : day.date)}
          >
            <div
              className="dup-bar"
              style={{ height: `${Math.max(total > 0 ? 3 : 0, Math.round((total / max) * 100))}%` }}
            />
            <span className="dup-barLabel">{index % labelStep === 0 ? day.date.slice(5) : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 单日明细：该日按模型分布（tokens / 调用 / 费用），带表头。 */
export function DayDetail(props: {
  date: string
  rows: UsageWireRow[]
  currency: string
  t(key: string): string
}): ReactElement {
  const { date, rows, currency, t } = props
  const merged: ModelTotal[] = totalsByModel(rows)
  const dayTotal = rows.reduce(
    (sum, r) => sum + r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens,
    0,
  )
  const dayCost = rows.reduce((sum, r) => (r.cost === null ? sum : r.cost), 0)
  const hasAnyCost = rows.some((r) => r.cost !== null)
  const costByKey = new Map(rows.map((r) => [`${r.provider}\u0000${r.model}`, r.cost] as const))
  return (
    <div className="dup-dayDetail">
      <div className="dup-dayHead">
        <span className="dup-dayDate">{date}</span>
        <span className="dup-dayMeta">
          {t('total')} {fmtTokens(dayTotal)} · {t('calls')}{' '}
          {rows.reduce((sum, r) => sum + r.calls, 0)}
          {hasAnyCost ? ` · ${fmtCost(dayCost, currency)}` : ''}
        </span>
      </div>
      {merged.length === 0 ? (
        <p className="dup-empty">{t('noData')}</p>
      ) : (
        <div className="dup-table dup-dayTable">
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
            const row = rows.find((r) => r.provider === m.provider && r.model === m.model)
            const hasCost = row?.cost !== null && row !== undefined
            return (
              <div className="dup-tr" key={`${m.provider}/${m.model}`}>
                <span className="dup-td dup-tdModel" data-label={`${t('provider')}/${t('model')}`}>
                  <span className="dup-provider">{m.provider}</span>
                  <span className="dup-model">{m.model}</span>
                </span>
                <span className="dup-td" data-label={`${t('inputTokens')}（tokens）`}>
                  {fmtTokens(m.inputTokens)}
                </span>
                <span className="dup-td" data-label={`${t('outputTokens')}（tokens）`}>
                  {fmtTokens(m.outputTokens)}
                </span>
                <span className="dup-td" data-label={`${t('cacheRead')}（tokens）`}>
                  {fmtTokens(m.cacheReadTokens)}
                </span>
                <span className="dup-td" data-label={t('calls')}>
                  {m.calls}
                </span>
                <span className="dup-td" data-label={t('cost')}>
                  {hasCost ? fmtCost(cost, currency) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 按模型明细表（calls 降序；≤767px 转纵向堆叠行，每格带标注）。 */
export function ModelTable(props: {
  rows: UsageWireRow[]
  currency: string
  t(key: string): string
}): ReactElement {
  const { rows, currency, t } = props
  const merged: ModelTotal[] = totalsByModel(rows)
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
            <span className="dup-td dup-tdModel" data-label={`${t('provider')}/${t('model')}`}>
              <span className="dup-provider">{m.provider}</span>
              <span className="dup-model">{m.model}</span>
            </span>
            <span className="dup-td" data-label={`${t('inputTokens')}（tokens）`}>
              {fmtTokens(m.inputTokens)}
            </span>
            <span className="dup-td" data-label={`${t('outputTokens')}（tokens）`}>
              {fmtTokens(m.outputTokens)}
            </span>
            <span className="dup-td" data-label={`${t('cacheRead')}（tokens）`}>
              {fmtTokens(m.cacheReadTokens)}
            </span>
            <span className="dup-td" data-label={t('calls')}>
              {m.calls}
            </span>
            <span className="dup-td" data-label={t('cost')}>
              {hasAnyCost ? fmtCost(cost, currency) : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
