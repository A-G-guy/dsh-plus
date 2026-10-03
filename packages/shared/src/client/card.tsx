/**
 * 卡片外壳（CardChrome）：官方配置卡片同构的可折叠 li——头部（标题/描述/
 * 状态徽标/未保存标记/chevron）+ 展开 body + footer（状态行 + 动作按钮）。
 * 各插件 card.tsx 只填 children 字段区与 actions；类名前缀与样式由
 * cardCss(prefix) 配套。交互对齐官方卡片：折叠/展开、staged draft、
 * 未保存标记在折叠态也可见。
 *
 * 两种形态（variant）：
 * - `card`：自绘带边框卡片，用于 legacy `settings.plugin.item` 列表槽位；
 * - `section`：无边框分节，用于 0.1.6-alpha.2 插件页（`plugins.row.config` /
 *   `plugins.bundle.config` 的 page 视图）——宿主页面自己画标题、图标与面包屑，
 *   并把视图放进已有内边距的页面容器里，再套一层卡片会形成卡片套卡片
 *   （移动端可用宽度被逐层扣减）。分节形态按官方设置页度量输出：13px/600
 *   小节标题 + 字段区 + 页脚动作（非 sticky），横向零额外内边距。
 *
 * 视图 → 形态的映射是纯函数，见 config-slots.ts 的 cardVariantFor。
 * @module @dsh-plus/shared/client/card
 */
import type { ReactNode } from 'react'

import type { PluginCardVariant } from './config-slots.ts'
import { ChevronDownIcon } from './icons.tsx'

export interface CardStatusState {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

export const IDLE_STATUS: CardStatusState = { kind: 'idle', text: '' }

/** 外壳形态（与 config-slots.ts 的 PluginCardVariant 同义，卡片侧沿用短名）。 */
export type CardVariant = PluginCardVariant

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
  /** 外壳形态，缺省 `card`；插件页 page 视图传 `cardVariantFor(props.view)`。 */
  variant?: CardVariant | undefined
  /**
   * 折叠态头部徽标（如「已启用/未启用」）；展开态窄屏隐藏。
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

/** 状态行 + 动作按钮（两种形态共用，类名随形态切换度量）。 */
function CardFoot(props: CardChromeProps): ReactNode {
  const p = props.prefix
  const section = props.variant === 'section'
  return (
    <div className={section ? `${p}-sectionFooter` : `${p}-footer`}>
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
  )
}

/** 只读提示 + 字段区 + 页脚（两种形态共用）。 */
function CardBody(props: CardChromeProps): ReactNode {
  const p = props.prefix
  return (
    <>
      {props.readOnlyNotice !== undefined ? (
        <p className={`${p}-readOnly`} role="status">
          {props.readOnlyNotice}
        </p>
      ) : null}
      {props.children}
      <CardFoot {...props} />
    </>
  )
}

export function CardChrome(props: CardChromeProps): ReactNode {
  const p = props.prefix
  const badge = props.statusBadge
  if (props.variant === 'section') {
    // 分节形态：无折叠（宿主页面即表单落地页），无边框/背景/横向内边距。
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
        {props.description === '' ? null : (
          <p className={`${p}-sectionDesc`}>{props.description}</p>
        )}
        <div className={`${p}-sectionBody`}>
          <CardBody {...props} />
        </div>
      </section>
    )
  }
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
          <CardBody {...props} />
        </div>
      ) : null}
    </li>
  )
}

/** 取值未到达时的占位：与 CardChrome 同形态，避免宿主页里闪一次卡片外壳。 */
export function CardLoading(props: {
  prefix: string
  text: string
  variant?: CardVariant | undefined
}): ReactNode {
  if (props.variant === 'section') {
    return (
      <section className={`${props.prefix}-section`}>
        <p className={`${props.prefix}-readOnly`} role="status">
          {props.text}
        </p>
      </section>
    )
  }
  return (
    <li className={`${props.prefix}-card`}>
      <p className={`${props.prefix}-readOnly`} role="status">
        {props.text}
      </p>
    </li>
  )
}
