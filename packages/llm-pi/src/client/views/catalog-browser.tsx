/**
 * 内置模型目录浏览器：搜索（服务端模糊匹配）/筛选/分页 + 复制路径 id +
 * 一键把 `{id, extends: 'provider/model'}` 加到目标 route。
 *
 * 数据全部来自本插件的 `/catalog` 端点（浏览器半读不到 pi-ai 包）：
 * - `apis`（provider → modelId → api）用于推断目标 route 的生效协议，
 *   在添加前拦下"协议不一致/重复 id/协议不受支持"这三类必然失败的添加；
 * - 模型行的参数直接渲染服务端给的事实（含官方新增字段，见 `rest`）。
 * 折叠由外层（card.tsx）控制，故本组件只管内容与交互。
 *
 * 结构：`useCatalogSearch`（拉取/分页状态）+ `BrowserToolbar`（搜索与筛选条）
 * + `CatalogRow`（明细行），`CatalogBrowser` 只做编排。
 * @module llm-pi/client/views/catalog-browser
 */

import { CheckRow } from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'

import {
  type CatalogQuery,
  searchCatalog,
  type WireModelInfo,
  type WireProviderEntry,
} from '../api.ts'
import { protocolOptions } from '../constants.ts'
import type { ProviderDraft } from '../draft.ts'
import type { Translate } from '../i18n.ts'
import { type ApiIndex, addEligibility } from '../route-fit.ts'
import { CatalogRow } from './catalog-row.tsx'

/** 计数展示（千分位；不引本地化依赖）。 */
function count(value: number): string {
  return value.toLocaleString()
}

/** 一页条数（服务端同样有上限；"加载更多"按此翻页）。 */
const PAGE_SIZE = 30
/** 搜索去抖毫秒（本地端点，短去抖即可）。 */
const DEBOUNCE_MS = 180

export interface CatalogBrowserProps {
  t: Translate
  /** 可作为目标的 route（已按 adapter: pi 过滤）。 */
  targets: string[]
  /** 目标 route 草稿（判定可否添加；不存在即 undefined）。 */
  providerOf(route: string): ProviderDraft | undefined
  /** 目标 route 的生效协议（选择器徽标用）。 */
  routeApiOf(route: string): string | undefined
  apis: ApiIndex
  providers: WireProviderEntry[]
  target: string
  onTargetChange(route: string): void
  /** 添加回调；返回 false 表示未添加（同 id 已存在）。 */
  onAdd(route: string, model: WireModelInfo): boolean
  disabled?: boolean
  /** 目录索引拉取失败时的错误文案（此时只显示提示，不渲染筛选）。 */
  metaError?: string
}

/** 计数展示（千分位；不引本地化依赖）。 */
/** 参数行的键值短展示：字符串化，长值截断。 */
/** 禁止添加的原因文案。 */
interface SearchState {
  items: WireModelInfo[]
  total: number
  servableHidden: number
  loading: boolean
  error: string
}

const EMPTY_STATE: SearchState = {
  items: [],
  total: 0,
  servableHidden: 0,
  loading: false,
  error: '',
}

/**
 * 目录搜索状态机：条件变化重新拉第一页（旧请求按 requestId 丢弃，避免竞态覆盖），
 * `loadMore` 追加下一页。
 */
function useCatalogSearch(
  filters: CatalogQuery,
  enabled: boolean,
): SearchState & { loadMore(): void } {
  const [state, setState] = useState<SearchState>(EMPTY_STATE)
  const requestId = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const id = requestId.current + 1
    requestId.current = id
    setState((prev) => ({ ...prev, loading: true, error: '' }))
    const controller = new AbortController()
    void searchCatalog({ ...filters, offset: 0, limit: PAGE_SIZE }, controller.signal)
      .then((page) => {
        if (requestId.current !== id) return
        setState({
          items: page.items,
          total: page.total,
          servableHidden: page.servableHidden,
          loading: false,
          error: '',
        })
      })
      .catch((error: unknown) => {
        if (requestId.current !== id) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      })
    return () => controller.abort()
  }, [filters, enabled])

  const loadMore = (): void => {
    const id = requestId.current + 1
    requestId.current = id
    setState((prev) => ({ ...prev, loading: true }))
    void searchCatalog({ ...filters, offset: state.items.length, limit: PAGE_SIZE })
      .then((page) => {
        if (requestId.current !== id) return
        setState((prev) => ({
          ...prev,
          items: [...prev.items, ...page.items],
          total: page.total,
          servableHidden: page.servableHidden,
          loading: false,
        }))
      })
      .catch((error: unknown) => {
        if (requestId.current !== id) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      })
  }
  return { ...state, loadMore }
}

/** 搜索框输入（本地态）→ 去抖后的查询串。 */
function useDebouncedQuery(query: string): string {
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])
  return debounced
}

interface ToolbarProps {
  t: Translate
  query: string
  onQuery(value: string): void
  provider: string
  onProvider(value: string): void
  api: string
  onApi(value: string): void
  reasoning: boolean
  onReasoning(value: boolean): void
  image: boolean
  onImage(value: boolean): void
  servableOnly: boolean
  onServableOnly(value: boolean): void
  providers: WireProviderEntry[]
  targets: string[]
  target: string
  onTarget(value: string): void
  targetApi: string | undefined
  disabled: boolean
}

/** 搜索/筛选/目标 route 三条工具条。 */
function BrowserToolbar(props: ToolbarProps): ReactElement {
  const { t } = props
  return (
    <>
      <div className="lpc-catBar">
        <input
          className="lpc-input lpc-catSearch"
          type="search"
          value={props.query}
          placeholder={t('browserSearchPlaceholder')}
          aria-label={t('browserSearch')}
          disabled={props.disabled}
          onChange={(event) => props.onQuery(event.target.value)}
        />
        <select
          className="lpc-input lpc-select lpc-catSelect"
          value={props.provider}
          aria-label={t('browserProvider')}
          disabled={props.disabled}
          onChange={(event) => props.onProvider(event.target.value)}
        >
          <option value="">{`${t('browserProvider')}：${t('browserAll')}`}</option>
          {props.providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {`${entry.id}（${entry.modelCount}）`}
            </option>
          ))}
        </select>
        <select
          className="lpc-input lpc-select lpc-catSelect"
          value={props.api}
          aria-label={t('browserApi')}
          disabled={props.disabled}
          onChange={(event) => props.onApi(event.target.value)}
        >
          <option value="">{`${t('browserApi')}：${t('browserAll')}`}</option>
          {protocolOptions().map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>
      <div className="lpc-catBar">
        <CheckRow
          prefix="lpc"
          id="lpc-cat-servable"
          label={t('browserOnlyServable')}
          checked={props.servableOnly}
          disabled={props.disabled}
          onEdit={props.onServableOnly}
        />
        <CheckRow
          prefix="lpc"
          id="lpc-cat-reasoning"
          label={t('browserReasoning')}
          checked={props.reasoning}
          disabled={props.disabled}
          onEdit={props.onReasoning}
        />
        <CheckRow
          prefix="lpc"
          id="lpc-cat-image"
          label={t('browserImage')}
          checked={props.image}
          disabled={props.disabled}
          onEdit={props.onImage}
        />
      </div>
      <div className="lpc-catBar">
        <label className="lpc-catLabel" htmlFor="lpc-cat-target">
          {t('browserTarget')}
        </label>
        <select
          id="lpc-cat-target"
          className="lpc-input lpc-select lpc-catSelect"
          value={props.target}
          disabled={props.disabled || props.targets.length === 0}
          onChange={(event) => props.onTarget(event.target.value)}
        >
          {props.targets.length === 0 ? <option value="">-</option> : null}
          {props.targets.map((route) => (
            <option key={route} value={route}>
              {route}
            </option>
          ))}
        </select>
        <span className="lpc-catNote">
          {props.targetApi === undefined
            ? t('browserNoProtocol')
            : `${t('browserTargetProtocol')}：${props.targetApi}`}
        </span>
      </div>
    </>
  )
}

export function CatalogBrowser(props: CatalogBrowserProps): ReactElement {
  const { t } = props
  const [query, setQuery] = useState('')
  const debounced = useDebouncedQuery(query)
  const [provider, setProvider] = useState('')
  const [api, setApi] = useState('')
  const [reasoning, setReasoning] = useState(false)
  const [image, setImage] = useState(false)
  const [servableOnly, setServableOnly] = useState(true)
  const [note, setNote] = useState('')

  const filters = useMemo(
    () => ({ q: debounced, provider, api, reasoning, image, servableOnly }),
    [debounced, provider, api, reasoning, image, servableOnly],
  )
  const { items, total, servableHidden, loading, error, loadMore } = useCatalogSearch(
    filters,
    props.metaError === undefined,
  )

  if (props.metaError !== undefined) {
    return <p className="lpc-invalid">{`${t('browserFailed')}${props.metaError}`}</p>
  }

  const onAdd = (model: WireModelInfo): void => {
    if (props.target === '') return
    const added = props.onAdd(props.target, model)
    setNote(
      added
        ? `${t('browserAddedTo')} ${props.target}：${model.path}`
        : `${t('blockDuplicate')}：${model.path}`,
    )
  }
  const disabled = props.disabled === true
  return (
    <div className="lpc-cat">
      <p className="lpc-hint">{t('browserHint')}</p>
      <BrowserToolbar
        t={t}
        query={query}
        onQuery={setQuery}
        provider={provider}
        onProvider={setProvider}
        api={api}
        onApi={setApi}
        reasoning={reasoning}
        onReasoning={setReasoning}
        image={image}
        onImage={setImage}
        servableOnly={servableOnly}
        onServableOnly={setServableOnly}
        providers={props.providers}
        targets={props.targets}
        target={props.target}
        onTarget={props.onTargetChange}
        targetApi={props.target === '' ? undefined : props.routeApiOf(props.target)}
        disabled={disabled}
      />
      {props.targets.length === 0 ? <p className="lpc-hint">{t('browserNoTarget')}</p> : null}
      <p className="lpc-catSummary">
        {`${t('browserMatched')} ${count(total)}`}
        {servableHidden > 0
          ? ` · ${t('browserHiddenServable')} ${count(servableHidden)} ${t('browserHiddenUnit')}`
          : ''}
        {loading ? ` · ${t('browserLoading')}` : ''}
      </p>
      {error !== '' ? <p className="lpc-invalid">{`${t('browserFailed')}${error}`}</p> : null}
      {!loading && error === '' && items.length === 0 ? (
        <p className="lpc-hint">{t('browserEmpty')}</p>
      ) : null}
      <div className="lpc-catList">
        {items.map((model) => (
          <CatalogRow
            key={model.path}
            t={t}
            model={model}
            disabled={disabled}
            eligibility={addEligibility({
              model,
              provider: props.providerOf(props.target),
              apis: props.apis,
            })}
            onAdd={() => onAdd(model)}
          />
        ))}
      </div>
      {items.length > 0 && items.length < total ? (
        <div className="lpc-catMore">
          <button
            type="button"
            className="lpc-btn lpc-btnGhost lpc-btnSmall"
            disabled={loading}
            onClick={loadMore}
          >
            {t('browserLoadMore')}
          </button>
        </div>
      ) : null}
      {note !== '' ? <p className="lpc-catNote">{note}</p> : null}
    </div>
  )
}
