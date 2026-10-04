/**
 * 目录浏览器的单行：路径 id（可复制）+ 名称 + 协议徽标 + 参数行 + 折叠的参数明细
 * + 「添加到 route」（不可添加时按钮文案即原因）。与浏览器主体拆开，
 * 便于各自演进（行内只依赖服务端给的模型事实）。
 * @module llm-pi/client/views/catalog-row
 */

import {
  ChevronDownIcon,
  copyText,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useRef, useState } from 'react'

import type { WireModelInfo } from '../api.ts'
import type { Translate } from '../i18n.ts'
import type { AddBlockReason, AddEligibility } from '../route-fit.ts'

/** 计数展示（千分位；不引本地化依赖）。 */
function count(value: number): string {
  return value.toLocaleString()
}

/** 参数行的键值短展示：字符串化，长值截断。 */
function shortValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) return 'undefined'
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

/** 禁止添加的原因文案。 */
export function blockText(t: Translate, reason: AddBlockReason, detail?: string): string {
  if (reason === 'unsupported') {
    return `${t('blockUnsupported')}${detail === undefined ? '' : `（${detail}）`}`
  }
  if (reason === 'duplicate') return t('blockDuplicate')
  if (reason === 'protocol-conflict') {
    return `${t('blockConflict')}${detail === undefined || detail === '' ? '' : `（${detail}）`}`
  }
  if (reason === 'route-mixed') return t('blockMixed')
  return t('blockNoRoute')
}

export interface CatalogRowProps {
  t: Translate
  model: WireModelInfo
  disabled: boolean
  eligibility: AddEligibility
  onAdd(): void
}

/** 单行：路径 id（可复制）+ 名称 + 参数行 + 折叠的参数明细 + 添加按钮。 */
export function CatalogRow(props: CatalogRowProps): ReactElement {
  const { t, model } = props
  const [details, setDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  const blocked = props.eligibility.ok ? undefined : props.eligibility
  const compatKeys = Object.keys(model.compat ?? {})
  const restKeys = Object.keys(model.rest)
  return (
    <div className="lpc-catRow">
      <div className="lpc-catHead">
        <span className="lpc-catPath">{model.path}</span>
        <button
          type="button"
          className="lpc-iconBtn"
          title={copied ? t('browserCopied') : t('browserCopy')}
          aria-label={t('browserCopy')}
          onClick={() => {
            void copyText(model.path).then((ok) => {
              if (!ok) return
              setCopied(true)
              if (timer.current !== null) clearTimeout(timer.current)
              timer.current = setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
        </button>
        <span className="lpc-catName">{model.name}</span>
        <span className={model.servable ? 'lpc-badge lpc-badgeSet' : 'lpc-badge lpc-badgeUnset'}>
          {model.api}
        </span>
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled || blocked !== undefined}
          title={blocked === undefined ? undefined : blockText(t, blocked.reason, blocked.detail)}
          onClick={props.onAdd}
        >
          {blocked === undefined ? t('browserAdd') : blockText(t, blocked.reason, blocked.detail)}
        </button>
      </div>
      <p className="lpc-catParams">
        {`${t('browserContextShort')} ${count(model.contextWindow)} · ${t('browserMaxShort')} ${count(model.maxTokens)} · `}
        {model.input
          .map((m) => (m === 'image' ? t('browserInputImage') : t('browserInputText')))
          .join('/')}
        {model.reasoning ? ` · ${t('browserReasoning')}` : ''}
        {compatKeys.length > 0 ? ` · compat ${compatKeys.length}` : ''}
      </p>
      <button
        type="button"
        className="lpc-catDetailsToggle"
        aria-expanded={details}
        onClick={() => setDetails(!details)}
      >
        <ChevronDownIcon className={`lpc-chevron${details ? ' lpc-chevronOpen' : ''}`} />
        <span>{t('browserDetails')}</span>
      </button>
      {details ? (
        <div className="lpc-catDetails">
          {model.thinkingLevelMap !== undefined ? (
            <p className="lpc-catParams">
              {`${t('browserThinkMap')}：${Object.entries(model.thinkingLevelMap)
                .map(([level, wire]) => `${level}=${wire ?? '-'}`)
                .join(' ')}`}
            </p>
          ) : null}
          {compatKeys.length > 0 ? (
            <>
              <p className="lpc-catDetailLabel">{t('browserCompat')}</p>
              <pre className="lpc-catJson">{JSON.stringify(model.compat, null, 2)}</pre>
            </>
          ) : null}
          {restKeys.length > 0 ? (
            <>
              <p className="lpc-catDetailLabel">{t('browserExtra')}</p>
              <pre className="lpc-catJson">
                {restKeys.map((key) => `${key}: ${shortValue(model.rest[key])}`).join('\n')}
              </pre>
            </>
          ) : null}
          <p className="lpc-catParams">{`baseUrl：${model.baseUrl}`}</p>
        </div>
      ) : null}
    </div>
  )
}
