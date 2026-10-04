/**
 * 配置卡片外壳（CardChrome）：官方插件页设置表单同构的**无边框分节**。
 *
 * 宿主页面（`plugins.row.config` / `plugins.bundle.config` 的 page 视图）自己画
 * 标题、图标、面包屑与页面级内边距，视图只填内容区——所以这里不再自绘带边框
 * 卡片（会形成卡片套卡片，把移动端可用宽度逐层扣掉），也不做折叠：page 视图
 * 本身就是表单落地页。度量对齐官方设置页（dsh-client-ui-primitives 的
 * settings-form）：小节标题 13px/600、字段区零横向内边距、页脚非 sticky。
 *
 * 各插件 card.tsx 只填 children 字段区与 actions；类名前缀与样式由
 * cardCss(prefix) 配套。
 * @module @dsh-plus/shared/client/card
 */
import type { ReactNode } from 'react'

import { Button } from './fields.tsx'

export interface CardStatusState {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

export const IDLE_STATUS: CardStatusState = { kind: 'idle', text: '' }

export interface CardAction {
  key: string
  label: string
  variant?: 'ghost' | 'primary'
  disabled?: boolean
  onClick(): void
}

export interface CardChromeProps {
  prefix: string
  title: string
  description: string
  /**
   * 小节标题旁的状态徽标（如「已启用/未启用」）。
   *
   * 以下可选属性显式并上 `| undefined`：本组件对它们一律按「缺席或 undefined
   * 同等处理」（见下方 `!== undefined` 与真值判断），而调用方普遍写
   * `prop={cond ? value : undefined}`。exactOptionalPropertyTypes 下二者类型
   * 不同，故此处的并集是**如实表达契约**，而非放宽校验。
   */
  statusBadge?: { text: string; on: boolean } | undefined
  dirty?: boolean | undefined
  /** 未保存标记文案（如 t('unsaved')）。 */
  dirtyLabel: string
  /** 只读提示（无 settings provider 部署）。 */
  readOnlyNotice?: string | undefined
  status?: CardStatusState | undefined
  actions: CardAction[]
  children: ReactNode
}

export function CardChrome(props: CardChromeProps): ReactNode {
  const p = props.prefix
  const badge = props.statusBadge
  return (
    <section className={`${p}-section`} aria-label={props.title}>
      <div className={`${p}-sectionHead`}>
        <h3 className={`${p}-sectionTitle`}>{props.title}</h3>
        {badge !== undefined ? (
          <span className={`${p}-sectionBadge ${badge.on ? `${p}-statusOn` : `${p}-statusOff`}`}>
            {badge.text}
          </span>
        ) : null}
        {props.dirty ? <span className={`${p}-pending`}>{props.dirtyLabel}</span> : null}
      </div>
      {props.description === '' ? null : <p className={`${p}-sectionDesc`}>{props.description}</p>}
      <div className={`${p}-sectionBody`}>
        {props.readOnlyNotice !== undefined ? (
          <p className={`${p}-readOnly`} role="status">
            {props.readOnlyNotice}
          </p>
        ) : null}
        {props.children}
        <div className={`${p}-sectionFooter`}>
          {props.status !== undefined && props.status.kind !== 'idle' ? (
            <p
              className={`${p}-status${props.status.kind === 'error' ? ` ${p}-statusError` : ''}`}
              role="status"
            >
              {props.status.text}
            </p>
          ) : null}
          {props.actions.map((action) => (
            <Button
              key={action.key}
              prefix={p}
              label={action.label}
              variant={action.variant}
              disabled={action.disabled}
              onClick={action.onClick}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

/** 取值未到达时的占位：与 CardChrome 同形态，避免宿主页里闪一次卡片外壳。 */
export function CardLoading(props: { prefix: string; text: string }): ReactNode {
  return (
    <section className={`${props.prefix}-section`}>
      <p className={`${props.prefix}-readOnly`} role="status">
        {props.text}
      </p>
    </section>
  )
}
