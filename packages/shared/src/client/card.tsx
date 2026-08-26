/**
 * 卡片外壳（CardChrome）：官方配置卡片同构的可折叠 li——头部（标题/描述/
 * 状态徽标/未保存标记/chevron）+ 展开 body + footer（状态行 + 动作按钮）。
 * 各插件 card.tsx 只填 children 字段区与 actions；类名前缀与样式由
 * cardCss(prefix) 配套。交互对齐官方卡片：折叠/展开、staged draft、
 * 未保存标记在折叠态也可见。
 * @module @dsh-plus/shared/client/card
 */
import type { ReactNode } from 'react'

import { ChevronDownIcon } from './icons.tsx'

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
  open: boolean
  onToggle(open: boolean): void
  /** 折叠态头部徽标（如「已启用/未启用」）；展开态窄屏隐藏。 */
  statusBadge?: { text: string; on: boolean }
  dirty?: boolean
  /** 未保存标记文案（如 t('unsaved')）。 */
  dirtyLabel: string
  /** 只读提示（无 settings provider 部署）。 */
  readOnlyNotice?: string
  status?: CardStatusState
  actions: CardAction[]
  children: ReactNode
}

export function CardChrome(props: CardChromeProps): ReactNode {
  const p = props.prefix
  const badge = props.statusBadge
  return (
    <li className={`${p}-card${props.open ? ` ${p}-cardOpen` : ''}`}>
      <button
        type="button"
        className={`${p}-header`}
        aria-expanded={props.open}
        aria-label={props.title}
        onClick={() => props.onToggle(!props.open)}
      >
        <span className={`${p}-headText`}>
          <span className={`${p}-name`}>{props.title}</span>
          <span className={`${p}-description`}>{props.description}</span>
        </span>
        {badge !== undefined ? (
          <span className={`${p}-statusBadge ${badge.on ? `${p}-statusOn` : `${p}-statusOff`}`}>
            {badge.text}
          </span>
        ) : null}
        {props.dirty ? <span className={`${p}-pending`}>{props.dirtyLabel}</span> : null}
        <ChevronDownIcon className={`${p}-chevron${props.open ? ` ${p}-chevronOpen` : ''}`} />
      </button>
      {props.open ? (
        <div className={`${p}-body`}>
          {props.readOnlyNotice !== undefined ? (
            <p className={`${p}-readOnly`} role="status">
              {props.readOnlyNotice}
            </p>
          ) : null}
          {props.children}
          <div className={`${p}-footer`}>
            {props.status !== undefined && props.status.kind !== 'idle' ? (
              <p
                className={`${p}-status${props.status.kind === 'error' ? ` ${p}-statusError` : ''}`}
                role="status"
              >
                {props.status.text}
              </p>
            ) : null}
            {props.actions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={`${p}-btn ${
                  action.variant === 'primary' ? `${p}-btnPrimary` : `${p}-btnGhost`
                }`}
                disabled={action.disabled === true}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </li>
  )
}
